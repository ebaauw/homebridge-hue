// homebridge-hue/lib/HueBridge.js
// Copyright © 2016, 2017 Erik Baauw. All rights reserved.
//
// Homebridge plugin for Philips Hue.
//
// HueBridge provides support for Philips Hue bridges and dresden elektronik
// deCONZ gateways.
//
// Todo:
// - Support rules in separate accessories.

'use strict';

const deferred = require('deferred');
const fs = require('fs');
const os = require('os');
const request = require('request');
const semver = require('semver');
const util = require('util');
const WebSocket = require('ws');

const HueLightModule = require('./HueLight');
const HueSensorModule = require('./HueSensor');
const HueScheduleModule = require('./HueSchedule');
const HueLight = HueLightModule.HueLight;
const HueSensor = HueSensorModule.HueSensor;
const HueSchedule = HueScheduleModule.HueSchedule;

module.exports = {
  setHomebridge: setHomebridge,
  HueBridge: HueBridge
};

// ===== Homebridge ============================================================

let Accessory;
let Service;
let Characteristic;

function setHomebridge(homebridge) {
  HueLightModule.setHomebridge(homebridge);
  HueSensorModule.setHomebridge(homebridge);
  HueScheduleModule.setHomebridge(homebridge);
  Accessory = homebridge.platformAccessory;
  Service = homebridge.hap.Service;
  Characteristic = homebridge.hap.Characteristic;
}

// ===== HueBridge =============================================================

function HueBridge(platform, host) {
  this.log = platform.log;
  this.platform = platform;
  this.name = host;
  this.ipaddress = host.split(':')[0];
  this.url = 'http://' + host + '/api';
  this.type = 'bridge';
  this.defaultTransitiontime = 0.4;
  this.state = {
    heartrate: this.platform.config.heartrate,
    transitiontime: this.defaultTransitiontime,
    request: 0,
    touchlink: false,
    lights: 0,
    groups: 0,
    group0: 0,
    sensors: 0,
    schedules: 0,
    rules: 0
  };
  this.serviceList = [];
  this.lights = {};
  this.groups = {};
  this.sensors = {};
  this.schedules = {};
  this.rules = {};
}

HueBridge.prototype.getServices = function() {
  this.log.info('%s: %d services', this.name, this.serviceList.length);
  return this.serviceList;
};

HueBridge.prototype.accessories = function() {
  // jshint -W106
  this.accessoryMap = {};
  this.accessoryList = [];
  return this.getConfig()
  .then(function(obj) {
    this.name = obj.name;
    this.uuid_base = obj.bridgeid;
    this.username = this.platform.config.users[this.uuid_base] || '';
    this.config = {
      parallelRequests: 10,
      linkbutton: this.platform.config.linkbutton
    };
    const recommendedVersion =
      this.platform.packageConfig.engines[obj.modelid.toLowerCase()];
    switch (obj.modelid) {
      case 'BSB001':                // Philips Hue v1 (round) bridge;
        this.config.parallelRequests = 3;
        /* falls through */
      case 'BSB002':                // Philips Hue v2 (square) bridge;
        obj.manufacturername = 'Philips';
        this.log.info(
          '%s: %s %s v%s, api v%s', this.name, obj.modelid, this.type,
          obj.swversion, obj.apiversion
        );
        this.version = obj.apiversion;
        if (!semver.satisfies(this.version, recommendedVersion)) {
          this.log.warn(
            '%s: warning: not using recommeneded Hue bridge api version %s',
            this.name, recommendedVersion
          );
        }
        break;
      case 'deCONZ':                // deCONZ rest api
        if (obj.bridgeid === '0000000000000000') {
          this.log.error(
            '%s: gateway not yet initialised - please restart homebridge',
            obj.name
          );
          process.exit(1);
        }
        obj.manufacturername = 'dresden elektronik';
        this.type = 'gateway';
        this.config.linkbutton = false;
        this.version = obj.swversion;
        this.log.info(
          '%s: %s %s v%s, api v%s', this.name, obj.modelid, this.type,
          obj.swversion, obj.apiversion
        );
        if (!semver.satisfies(this.version, recommendedVersion)) {
          this.log.warn(
            '%s: warning: not using recommended deCONZ gateway version %s',
            this.name, recommendedVersion
          );
        }
        break;
      default:
        this.log.warn('%s: warning: unknown bridge type %j', this.name, obj);
        break;
    }
    this.request = deferred.gate(
      this._request,
      this.platform.config.parallelRequests || this.config.parallelRequests
    );
    this.infoService = new Service.AccessoryInformation();
    this.serviceList.push(this.infoService);
    this.infoService
      .updateCharacteristic(Characteristic.Manufacturer, obj.manufacturername)
      .updateCharacteristic(Characteristic.Model, obj.modelid)
      .updateCharacteristic(Characteristic.SerialNumber, this.uuid_base)
      .updateCharacteristic(Characteristic.FirmwareRevision, this.version);
    this.obj = obj;
    this.obj.linkbutton = false;
    this.refresh();
    this.service = new Service.HueBridge(this.name);
    this.serviceList.push(this.service);
    this.service.getCharacteristic(Characteristic.Heartrate)
      .updateValue(this.state.heartrate)
      .on('set', this.setHeartrate.bind(this));
    this.service.getCharacteristic(Characteristic.LastUpdated)
      .updateValue(this.hk.lastupdated);
    this.service.getCharacteristic(Characteristic.TransitionTime)
      .updateValue(this.state.transitiontime)
      .on('set', this.setTransitionTime.bind(this));
    this.service.getCharacteristic(Characteristic.Link)
      .updateValue(this.hk.link)
      .on('set', this.setLink.bind(this));
    this.service.getCharacteristic(Characteristic.Touchlink)
      .updateValue(this.hk.touchlink)
      .on('set', this.setTouchlink.bind(this));
    if (this.config.linkbutton) {
      this.switchService = new Service.StatelessProgrammableSwitch(this.name);
      this.serviceList.push(this.switchService);
      this.switchService
        .getCharacteristic(Characteristic.ProgrammableSwitchEvent)
          .setProps({
            minValue: Characteristic.ProgrammableSwitchEvent.SINGLE_PRESS,
            maxValue: Characteristic.ProgrammableSwitchEvent.SINGLE_PRESS
          });
    }
    this.accessoryList.push(this);
  }.bind(this))
  .then(this.createUser.bind(this))
  .then(this.createGroup0.bind(this))
  .then(this.createResources.bind(this))
  .catch(function(err) {
    if (err.message) {
      this.log.error(err.message);
    }
  }.bind(this))
  .then(function() {
    this.log.info('%s: %d accessories', this.name, this.accessoryList.length);
    return this.accessoryList;
  }.bind(this));
};

HueBridge.prototype.getConfig = function() {
  const d = deferred();

  this._request('get', '/config').then(function(obj) {
    d.resolve(obj);
  }.bind(this))
  .catch(function (err) {
    setTimeout(function() {
      d.resolve(this.getConfig());
    }.bind(this), 15000);
  }.bind(this));
  return d.promise;
};

HueBridge.prototype.createUser = function() {
  if (this.username) {
    this.url += '/' + this.username;
    return deferred(true);
  }
  const d = deferred();
  // jshint -W106
  const devicetype = ('homebridge-hue#' + os.hostname().split('.')[0])
    .substr(0, 40);
  this.request('post', '/', {devicetype: devicetype})
  .then(function(obj) {
    this.username = obj[0].success.username;
    this.url += '/' + this.username;
    let s = '\n';
    s += '  "platforms": [\n';
    s += '    "platform": "Hue",\n';
    s += '    "name": "Hue",\n';
    s += '    "users": {\n';
    s += '      "' + this.uuid_base + '": "' + this.username + '"\n';
    s += '    }\n';
    s += '  ]';
    this.log.info(
      '%s: created user - please edit config.json and restart homebridge%s',
    	this.name, s
    );
    d.resolve();
  }.bind(this))
  .catch(function (err) {
    this.log.info(
      '%s: press link button on the bridge to create a user', this.name
    );
    setTimeout(function() {
      d.resolve(this.createUser());
    }.bind(this), 15000);
  }.bind(this));
  return d.promise;
};

HueBridge.prototype.createResources = function() {
  // jshint -W106
  return this._request('get', '/').then(function(obj) {
    if (obj.config.websocketport) {
      this.wsURL = 'ws://' + this.ipaddress + ':' + obj.config.websocketport;
      this.listen();
    }
    if (this.platform.config.lights) {
      for (const id in obj.lights) {
        const lightObj = obj.lights[id];
        if (lightObj.manufacturer) {
          lightObj.manufacturername = lightObj.manufacturer;
        }
        if (
          this.platform.config.philipsLights ||
          lightObj.manufacturername !== 'Philips'
        ) {
          this.log.debug(
            '%s: /lights/%d: %s %s (%s) "%s"', this.name, id,
            lightObj.manufacturername, lightObj.modelid, lightObj.type,
            lightObj.name
          );
          const light = new HueLight(this, id, lightObj);
          this.lights[id] = light;
          const uuid = light.uuid_base;
          const accessory = this.accessoryMap[uuid];
          if (accessory) {
            accessory.serviceList.push(light.service);
          } else {
            this.accessoryMap[uuid] = light;
            this.accessoryList.push(light);
          }
        } else {
          this.log.debug(
            '%s: /lights/%d: ignoring %s %s (%s) "%s"', this.name, id,
            lightObj.manufacturername, lightObj.modelid, lightObj.type,
            lightObj.name
          );
        }
      }
      this.state.lights = Object.keys(this.lights).length;
    }
    this.log.debug('%s: %d lights', this.name, this.state.lights);
    if (this.platform.config.groups) {
      for (const id in obj.groups) {
        const group = obj.groups[id];
        if (this.platform.config.rooms || group.type !== 'Room') {
          this.log.debug(
            '%s: /groups/%d: %s "%s"', this.name, id, group.type, group.name
          );
          this.groups[id] = new HueLight(this, id, group, 'group');
          this.accessoryList.push(this.groups[id]);
        } else {
          this.log.debug(
            '%s: /groups/%d: ingoring %s "%s"', this.name, id,
            group.type, group.name
          );
        }
      }
      this.state.groups = Object.keys(this.groups).length;
    }
    this.log.debug('%s: %d groups', this.name, this.state.groups);
    if (this.platform.config.sensors) {
      for (const id in obj.sensors) {
        const sensorObj = obj.sensors[id];
        if (this.platform.config.excludeSensorTypes[sensorObj.type] ||
            (sensorObj.type.substring(0, 4) === 'CLIP'  &&
             this.platform.config.excludeSensorTypes.CLIP)) {
          this.log.debug(
            '%s: /sensors/%d: ignoring %s sensor "%s"', this.name, id,
            sensorObj.type, sensorObj.name
          );
        } else if (
          sensorObj.name === '_dummy' || sensorObj.uniqueid === '_dummy'
        ) {
          this.log.debug(
            '%s: /sensors/%d: ignoring dummy sensor', this.name, id
          );
        } else {
          if ((sensorObj.type[0] === 'Z')) {
            this.log.debug(
              '%s: /sensors/%d: %s %s (%s) "%s"', this.name, id,
              sensorObj.manufacturername, sensorObj.modelid, sensorObj.type,
              sensorObj.name
            );
          } else {
            this.log.debug(
              '%s: /sensors/%d: %s "%s"', this.name, id,
              sensorObj.type, sensorObj.name
            );
          }
          const sensor = new HueSensor(this, id, sensorObj);
          this.sensors[id] = sensor;
          const uuid = sensor.uuid_base;
          const accessory = this.accessoryMap[uuid];
          if (accessory) {
            for (let service of sensor.serviceList) {
              if (service.UUID !== Service.AccessoryInformation.UUID) {
                accessory.serviceList.push(service);
              }
            }
          } else {
            this.accessoryMap[uuid] = sensor;
            this.accessoryList.push(sensor);
          }
        }
      }
      this.state.sensors = Object.keys(this.sensors).length;
    }
    this.log.debug('%s: %d sensors', this.name, this.state.sensors);
    if (this.platform.config.schedules) {
      for (const id in obj.schedules) {
        const schedule = obj.schedules[id];
        this.log.debug(
          '%s: /schedules/%d: "%s"', this.name, id, schedule.name
        );
        this.schedules[id] = new HueSchedule(this, id, schedule);
        // this.accessoryList.push(this.schedules[id]);
        if (this.serviceList.length < 99) {
          this.serviceList.push(this.schedules[id].service);
        }
      }
      this.state.schedules = Object.keys(this.schedules).length;
    }
    this.log.debug('%s: %d schedules', this.name, this.state.schedules);
    if (this.platform.config.rules) {
      for (const id in obj.rules) {
        const rule = obj.rules[id];
        this.log.debug('%s: /rules/%d: "%s"', this.name, id, rule.name);
        this.rules[id] = new HueSchedule(this, id, rule, 'rule');
        // this.accessoryList.push(this.rules[id]);
        if (this.serviceList.length < 99) {
          this.serviceList.push(this.rules[id].service);
        }
      }
      this.state.rules = Object.keys(this.rules).length;
    }
    this.log.debug('%s: %d rules', this.name, this.state.rules);
  }.bind(this));
};

HueBridge.prototype.createGroup0 = function() {
  if (!this.platform.config.groups || !this.platform.config.group0) {
    return deferred(true);
  }
  return this.request('get', '/groups/0').then(function(group) {
    this.log.debug('%s: /groups/0: %s "%s"', this.name, group.type, group.name);
    this.groups[0] = new HueLight(this, 0, group, 'group');
    this.accessoryList.push(this.groups[0]);
    this.state.group0 = 1;
  }.bind(this));
};

HueBridge.prototype.refresh = function() {
  this.hk = {};
  this.hk.lastupdated = this.obj.UTC ?
    String(new Date(this.obj.UTC + 'Z')).substring(0, 24) : 'n/a';
  this.hk.link = this.obj.linkbutton ? 1 : 0;
  this.hk.touchlink = this.state.touchlink ? 1 : 0;
};

HueBridge.prototype.resetTransitionTime = function() {
  if (this.state.resetTimer) {
    return;
  }
  this.state.resetTimer = setTimeout(function () {
    this.log.info(
      '%s: reset homekit transition time from %ss to %ss', this.name,
      this.state.transitiontime, this.defaultTransitiontime
    );
    this.state.transitiontime = this.defaultTransitiontime;
    this.service.getCharacteristic(Characteristic.TransitionTime)
      .updateValue(this.state.transitiontime);
    delete this.state.resetTimer;
  }.bind(this), this.platform.config.waitTimeUpdate);
};

// ===== WebSocket =============================================================

HueBridge.prototype.listen = function(port) {
  this.ws = new WebSocket(this.wsURL);

  this.ws.on('open', () => {
    this.log.debug('%s: listening on %s', this.name, this.wsURL);
  });

  this.ws.on('message', (data, flags) => {
    try {
      const obj = JSON.parse(data);
      if (obj.e === 'changed' && obj.t === 'event') {
        let a;
        switch (obj.r) {
          case 'lights':
            a = this.lights[obj.id];
            break;
          case 'groups':
            a = this.groups[obj.id];
            break;
          case 'sensors':
            a = this.sensors[obj.id];
            break;
          default:
            break;
        }
        if (a) {
          if (obj.state !== undefined) {
            this.log.debug('%s: state changed event', a.name);
            a.checkState(obj.state, true);
          }
          if (obj.config !== undefined) {
            this.log.debug('%s: config changed event', a.name);
            a.checkConfig(obj.config, true);
          }
        }
      }
    } catch(e) {
      this.log.error('%s: websocket error %s', this.name, e);
    }
  });

  this.ws.on('error', (error) => {
    this.log.error(
      '%s: websocket communication error %s', this.name, error.code
    );
  });

  this.ws.on('close', () => {
    this.log.debug(
      '%s: websocket connection closed - retrying in 30 seconds', this.name
    );
    setTimeout(this.listen.bind(this), 30000);
  });
};

// ===== Heartbeat =============================================================

HueBridge.prototype.heartbeat = function(beat) {
  if (beat % this.state.heartrate === 0 && this.request) {
    this.heartbeatConfig()
    .then(this.heartbeatSensors.bind(this))
    .then(this.heartbeatLights.bind(this))
    .then(this.heartbeatGroups.bind(this))
    .then(this.heartbeatGroup0.bind(this))
    .then(this.heartbeatSchedules.bind(this))
    .then(this.heartbeatRules.bind(this))
    .catch(function (err) {
      if (err.message) {
        this.log.error(err.message);
      }
    }.bind(this));
  }
};

HueBridge.prototype.heartbeatConfig = function() {
  return this.request('get', '/config').then(function(obj) {
    const old = {
      obj: this.obj,
      hk: this.hk
    };
    this.obj = obj;
    this.refresh();
    this.service
      .updateCharacteristic(Characteristic.LastUpdated, this.hk.lastupdated);
    if (this.obj.linkbutton !== old.obj.linkbutton) {
      if (this.config.linkbutton) {
        this.log.debug(
          '%s: bridge linkbutton on %s', this.name, this.obj.UTC
        );
        this.log(
          '%s: homekit linkbutton single press', this.switchService.displayName
        );
        this.hk.link = 0;
        this.switchService
          .updateCharacteristic(Characteristic.ProgrammableSwitchEvent, 0);
        this.request('put', '/config', {linkbutton: false}).then(function() {
          this.obj.linkbutton = false;
        }.bind(this));
      } else {
        this.log.debug(
          '%s: bridge linkbutton changed from %s to %s', this.name,
          old.obj.linkbutton, this.obj.linkbutton
        );
      }
    }
    if (this.hk.link !== old.hk.link) {
      this.log(
        '%s: set homekit link from %s to %s', this.name,
        old.hk.link, this.hk.link
      );
      this.service.updateCharacteristic(Characteristic.Link, this.hk.link);
    }
    if (this.hk.touchlink !== old.hk.touchlink) {
      this.log(
        '%s: set homekit touchlink from %s to %s', this.name,
        old.hk.touchlink, this.hk.touchlink
      );
      this.service
        .updateCharacteristic(Characteristic.Touchlink, this.hk.touchlink);
    }
  }.bind(this));
};

HueBridge.prototype.heartbeatSensors = function() {
  if (!this.state.sensors) {
    return deferred(true);
  }
  return this.request('get', '/sensors').then(function(sensors) {
    for (const id in sensors) {
      const a = this.sensors[id];
      if (a) {
        a.heartbeat(sensors[id]);
      }
    }
  }.bind(this));
};

HueBridge.prototype.heartbeatLights = function() {
  if (!this.state.lights) {
    return deferred(true);
  }
  return this.request('get', '/lights').then(function(lights) {
    for (const id in lights) {
      const a = this.lights[id];
      if (a) {
        a.heartbeat(lights[id]);
      }
    }
  }.bind(this));
};

HueBridge.prototype.heartbeatGroups = function() {
  if (!this.state.groups) {
    return deferred(true);
  }
  return this.request('get', '/groups').then(function(groups) {
    for (const id in groups) {
      const a = this.groups[id];
      if (a) {
        a.heartbeat(groups[id]);
      }
    }
  }.bind(this));
};

HueBridge.prototype.heartbeatGroup0 = function() {
  if (!this.state.group0) {
    return deferred(true);
  }
  return this.request('get', '/groups/0').then(function(obj) {
    const a = this.groups[0];
    if (a) {
      a.heartbeat(obj);
    }
  }.bind(this));
};

HueBridge.prototype.heartbeatSchedules = function() {
  if (!this.state.schedules) {
    return deferred(true);
  }
  return this.request('get', '/schedules').then(function(schedules) {
    for (const id in schedules) {
      const a = this.schedules[id];
      if (a) {
        a.heartbeat(schedules[id]);
      }
    }
  }.bind(this));
};

HueBridge.prototype.heartbeatRules = function() {
  if (!this.state.rules) {
    return deferred(true);
  }
  return this.request('get', '/rules').then(function(rules) {
    for (const id in rules) {
      const a = this.rules[id];
      if (a) {
        a.heartbeat(rules[id]);
      }
    }
  }.bind(this));
};

// ===== Homekit Events ========================================================

HueBridge.prototype.setHeartrate = function(rate, callback) {
  if (rate === this.state.heartrate) {
    return callback();
  }
  this.log.info(
    '%s: homekit heartrate changed from %ss to %ss', this.name,
    this.state.heartrate, rate
  );
  this.state.heartrate = rate;
  return callback();
};

HueBridge.prototype.setTransitionTime = function(transitiontime, callback) {
  transitiontime = Math.round(transitiontime * 10) / 10;
  if (transitiontime === this.state.transitiontime) {
    return callback();
  }
  this.log.info(
    '%s: homekit transition time changed from %ss to %ss', this.name,
    this.state.transitiontime, transitiontime
  );
  this.state.transitiontime = transitiontime;
  return callback();
};

HueBridge.prototype.setLink = function(link, callback) {
  link = link ? 1 : 0;
  if (link === this.hk.link) {
    return callback();
  }
  this.log.info(
    '%s: homekit link changed from %s to %s', this.name,
    this.hk.link, link
  );
  this.hk.link = link;
  const newValue = link ? true : false;
  this.request('put', '/config', {linkbutton: newValue})
  .then(function () {
    this.obj.linkbutton = newValue;
    return callback();
  }.bind(this))
  .catch(function(err) {
    return callback(new Error(err));
  }.bind(this));
};

HueBridge.prototype.setTouchlink = function(touchlink, callback) {
  touchlink = touchlink ? 1 : 0;
  if (touchlink === this.hk.touchlink) {
    return callback();
  }
  this.log.info(
    '%s: homekit touchlink changed from %s to %s', this.name,
    this.hk.touchlink, touchlink
  );
  this.hk.touchlink = touchlink;
  if (!this.hk.touchlink) {
    return callback();
  }
  const newValue = touchlink ? true : false;
  this.request('put', '/config', {touchlink: newValue})
  .then(function() {
    this.state.touchlink = newValue;
    setTimeout(function () {
      this.log.info(
        '%s: set homekit touchlink from %s to %s', this.name,
        this.hk.touchlink, 0
      );
      this.state.touchlink = false;
      this.hk.touchlink = 0;
      this.service.getCharacteristic(Characteristic.Touchlink)
        .setValue(this.hk.touchlink);
    }.bind(this), 15000);
    return callback();
  }.bind(this))
  .catch(function (err) {
    return callback(new Error(err));
  }.bind(this));
};

HueBridge.prototype.identify = function(callback) {
  this.log.info('%s: identify', this.name);
  callback();
  this.request('get', '/')
  .then(function(body) {
    const filename = this.platform.api.user.storagePath() + "/" +
                     this.name + '.json';
    this.log.info('%s: dumping masked state to %s', this.name, filename);
    body.config.bridgeid = 'xxxxxxFFFExxxxxx';
    body.config.mac = 'xx:xx:xx:xx:xx:xx';
    body.config.ipaddress = 'xxx.xxx.xxx.xxx';
    body.config.gateway = 'xxx.xxx.xxx.xxx';
    if (body.config.proxyaddress !== 'none') {
      body.config.proxyaddress = 'xxx.xxx.xxx.xxx';
    }
    let json = JSON.stringify(body);
    let i = 0;
    for (const username in body.config.whitelist) {
      i += 1;
      const regexp = RegExp(username, 'g');
      let mask = username.replace(/./g, 'x');
      mask = (mask + i).slice(-username.length);
      json = json.replace(regexp, mask);
    }
    fs.writeFile(filename, json, function(err) {
      if (err) {
        this.log.error('cannot create %s: error %s', filename, err.code);
        return;
      }
    }.bind(this));
  }.bind(this))
  .catch(function(err) {
    if (err.message) {
      this.log.error(err.message);
    }
  }.bind(this));
};

// ===== Bridge Communication ==================================================

// Send request to bridge / gateway.
HueBridge.prototype._request = function(method, resource, body) {
  const d = deferred();
  const requestObj = {
    method: method,
    url: this.url + (resource === '/' ? '' : resource),
    headers: {'Connection': 'keep-alive'},
    timeout: 1000 * this.platform.config.timeout,
    json: true
  };
  const requestNumber = ++this.state.request;
  let requestMsg;
  requestMsg = util.format.apply(requestMsg, [
    '%s: %s request %d: %s %s', this.name, this.type,
    this.state.request, method, resource
  ]);
  if (body) {
    requestObj.body = body;
    requestMsg = util.format.apply(requestMsg, ['%s %j', requestMsg, body]);
  }
  this.log.debug(requestMsg);
  request(requestObj, function(err, response, responseBody) {
    if (err) {
      if (err.code === 'ECONNRESET') {
        this.log.debug(requestMsg);
        this.log.debug(
          '%s: %s communication error %s - retrying in 300ms',
          this.name, this.type, err.code
        );
        setTimeout(function () {
          d.resolve(this._request(method, resource, body));
        }.bind(this), this.platform.config.waitTimeResend);
        return;
      }
      this.log.error(requestMsg);
      this.log.error(
        '%s: %s communication error %s', this.name, this.type, err.code
      );
      return d.reject(err.code);
    }
    if (response.statusCode != 200) {
      this.log.error(requestMsg);
      this.log.error(
        '%s: %s http status %s %s', this.name, this.type,
        response.statusCode, response.statusMessage
      );
      return d.reject(response.statusCode);
    }
    if (util.isArray(responseBody)) {
      for (const id in responseBody) {
        const e = responseBody[id].error;
        if (e) {
          this.log.error(requestMsg);
          this.log.error(
            '%s: %s error %d: %s', this.name, this.type, e.type, e.description
          );
          return d.reject(e.type);
        }
      }
    }
    this.log.debug(
      '%s: %s request %d: ok', this.name, this.type, requestNumber
    );
    return d.resolve(responseBody);
  }.bind(this));
  return d.promise;
};
