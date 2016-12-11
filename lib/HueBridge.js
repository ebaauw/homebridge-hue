// homebridge-hue/lib/HueBridge.js
// (C) 2016, Erik Baauw
//
// Homebridge plugin for Philips Hue.
//
// HueBridge provides support for Philips Hue bridges.

"use strict";

const fs = require("fs");
const os = require("os");
const request = require("request");
const util = require("util");

const HueLightModule = require("./HueLight");
const HueSensorModule = require("./HueSensor");
const HueScheduleModule = require("./HueSchedule");
const HueLight = HueLightModule.HueLight;
const HueSensor = HueSensorModule.HueSensor;
const HueSchedule = HueScheduleModule.HueSchedule;

module.exports = {
  setHomebridge: setHomebridge,
  HueBridge: HueBridge
};

// ===== Homebridge ======================================================================

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

// ===== HueBridge =======================================================================

function HueBridge(platform, host) {
  this.log = platform.log;
  this.platform = platform;
  this.name = host;
  this.url = "http://" + host + "/api";
  this.lights = {};
  this.groups = {};
  this.sensors = {};
  this.schedules = {};
  this.rules = {};
}

HueBridge.prototype.getServices = function() {
  return [this.infoService];
};

HueBridge.prototype.accessories = function() {
  this.accessoryList = [];
  return this.request("get", "/config", null).then(function(obj) {
    this.name = obj.name;
    this.uuid_base = obj.bridgeid;
    this.username = this.platform.config.users[this.uuid_base] || "";
    this.infoService = new Service.AccessoryInformation();
    this.infoService
      .setCharacteristic(Characteristic.Manufacturer, "homebridge-hue")
      .setCharacteristic(Characteristic.Model, obj.modelid)
      .setCharacteristic(Characteristic.SerialNumber, this.uuid_base);
    this.accessoryList.push(this);
    this.log.info("%s: %s bridge, api v%s", this.name, obj.modelid, obj.apiversion);
    if (obj.apiversion != "1.15.0" && obj.apiversion != "1.16.0") {
      this.log.error("%s: warning api version %s", this.name, obj.apiversion);
    }
  }.bind(this))
  .then(this.createUser.bind(this))
  .then(this.createGroup0.bind(this))
  .then(this.createResources.bind(this))
  .catch(function(err) {
    this.log.error(err.message);
  }.bind(this))
  .then(function() {
    this.log.info("%s: %d accessories", this.name, this.accessoryList.length);
    return this.accessoryList;
  }.bind(this));
};

HueBridge.prototype.pressLinkButton = function(resolve) {
  this.request("post", "/", {devicetype: "homebridge-hue#" + os.hostname()})
  .then(function(obj) {
    this.username = obj[0].success.username;
    this.url += "/" + this.username;
    let s = '\n';
    s += '  "platforms": [\n';
    s += '    "platform": "Hue",\n';
    s += '    "name": "Hue",\n';
    s += '    "users": {\n';
    s += '      "' + this.uuid_base + '": "' + this.username + '"\n';
    s += '    }\n';
    s += "  ]";
    this.log.info("%s: created user - please edit config.json and restart homebridge%s",
    		          this.name, s);
    resolve();
  }.bind(this))
  .catch(function (err) {
    this.log.info("%s: press link button on the bridge to create a user", this.name);
    setTimeout(function() {
      this.pressLinkButton(resolve);
    }.bind(this), this.platform.config.timeout);
  }.bind(this));
};

HueBridge.prototype.createUser = function() {
  if (this.username) {
    this.url += "/" + this.username;
    return Promise.resolve();
  }
  return new Promise(function(resolve, reject) {
    this.pressLinkButton(resolve);
  }.bind(this));
};

HueBridge.prototype.createResources = function() {
  return this.request("get", "/", null).then(function(obj) {
    if (this.platform.config.lights) {
      for (const id in obj.lights) {
        const light = obj.lights[id];
        if (this.platform.config.philipslights || light.manufacturername !== "Philips") {
          this.log.debug("%s: %s: %s %s", this.name, light.name,
                         light.manufacturername, light.type);
          this.lights[id] = new HueLight(this, id, light);
          this.accessoryList.push(this.lights[id]);
        } else {
          this.log.debug("%s: %s: ignoring %s %s", this.name, light.name,
                         light.manufacturername, light.type);
        }
      }
    }
    this.log.debug("%s: %d lights", this.name, Object.keys(this.lights).length);
    if (this.platform.config.groups) {
      for (const id in obj.groups) {
        const group = obj.groups[id];
        if (this.platform.config.rooms || group.type !== "Room") {
          this.log.debug("%s: %s: %s", this.name, group.name, group.type);
          this.groups[id] = new HueLight(this, id, group, "group");
          this.accessoryList.push(this.groups[id]);
        } else {
          this.log.debug("%s: %s: ignoring %s", this.name, group.name, group.type);
        }
      }
    }
    this.log.debug("%s: %d groups", this.name, Object.keys(this.groups).length);
    if (this.platform.config.sensors) {
      for (const id in obj.sensors) {
        const sensor = obj.sensors[id];
        if (this.platform.config.clipsensors ||
            (sensor.type.substring(0, 4) !== "CLIP"  && sensor.type !== "Geofence")) {
          this.log.debug("%s: %s: %s sensor", this.name, sensor.name, sensor.type);
          this.sensors[id] = new HueSensor(this, id, sensor);
          this.accessoryList.push(this.sensors[id]);
        } else {
          this.log.debug("%s: %s: ingoring %s sensor", this.name, sensor.name, sensor.type);
        }
      }
    }
    this.log.debug("%s: %d sensors", this.name, Object.keys(this.sensors).length);
    if (this.platform.config.schedules) {
      for (const id in obj.schedules) {
        const schedule = obj.schedules[id];
        this.log.debug("%s: %s: schedule", this.name, schedule.name);
        this.schedules[id] = new HueSchedule(this, id, schedule);
        this.accessoryList.push(this.schedules[id]);
      }
    }
    this.log.debug("%s: %d schedules", this.name, Object.keys(this.schedules).length);
    if (this.platform.config.rules) {
      for (const id in obj.rules) {
        const rule = obj.rules[id];
        this.log.debug("%s: %s: rule", this.name, rule.name);
        this.rules[id] = new HueSchedule(this, id, rule, "rule");
        this.accessoryList.push(this.rules[id]);
      }
    }
    this.log.debug("%s: %d rules", this.name, Object.keys(this.rules).length);
  }.bind(this));
};

HueBridge.prototype.createGroup0 = function() {
  if (!this.platform.config.groups || !this.platform.config.group0) {
    return Promise.resolve();
  }
  return this.request("get", "/groups/0", null).then(function(group) {
    this.log.debug("%s: %s: %s", this.name, group.name, group.type);
    this.groups[0] = new HueLight(this, 0, group, "group");
    this.accessoryList.push(this.groups[0]);
  }.bind(this));
};

// ===== Heartbeat =======================================================================

HueBridge.prototype.heartbeat = function() {
  this.heartbeatResources()
  .then(this.heartbeatGroup0.bind(this))
  .catch(function (err) {
    this.log.error(err.message);
  }.bind(this));
};

HueBridge.prototype.heartbeatResources = function() {
  return this.request("get", "/", null).then(function(obj) {
    if (this.platform.config.sensors) {
      for (const id in obj.sensors) {
        const a = this.sensors[id];
        if (a) {
          a.heartbeat(obj.sensors[id]);
        }
      }
    }
    if (this.platform.config.lights) {
      for (const id in obj.lights) {
        const a = this.lights[id];
        if (a) {
          a.heartbeat(obj.lights[id]);
        }
      }
    }
    if (this.platform.config.groups) {
      for (const id in obj.groups) {
        const a = this.groups[id];
        if (a) {
          a.heartbeat(obj.groups[id]);
        }
      }
    }
    if (this.platform.config.schedules) {
      for (const id in obj.schedules) {
        const a = this.schedules[id];
        if (a) {
          a.heartbeat(obj.schedules[id]);
        }
      }
    }
    if (this.platform.config.rules) {
      for (const id in obj.rules) {
        const a = this.rules[id];
        if (a) {
          a.heartbeat(obj.rules[id]);
        }
      }
    }
  }.bind(this));
};

HueBridge.prototype.heartbeatGroup0 = function() {
  if (!this.platform.config.groups || !this.platform.config.group0) {
    return Promise.resolve();
  }
  return this.request("get", "/groups/0", null).then(function(obj) {
    const a = this.groups[0];
    if (a) {
      a.heartbeat(obj);
    }
  }.bind(this));
};

// ===== Homekit Events ==================================================================

HueBridge.prototype.identify = function(callback) {
  this.log.info("%s: identify", this.name);
  callback();
  this.request("get", "/", null)
  .then(function(body) {
    const filename = this.name + ".json";
    this.log.info("%s: dumping masked state to %s", this.name, filename);
    body.config.bridgeid = "xxxxxxFFFExxxxxx";
    body.config.mac = "xx:xx:xx:xx:xx:xx";
    body.config.ipaddress = "xxx.xxx.xxx.xxx";
    body.config.gateway = "xxx.xxx.xxx.xxx";
    if (body.config.proxyaddress !== "none") {
      body.config.proxyaddress = "xxx.xxx.xxx.xxx";
    }
    let json = JSON.stringify(body);
    let i = 0;
    for (const username in body.config.whitelist) {
      i += 1;
      const regexp = RegExp(username, "g");
      let mask = username.replace(/./g, "x");
      mask = (mask + i).slice(-username.length);
      json = json.replace(regexp, mask);
    }
    fs.writeFile(filename, json, function(err) {
      if (err) {
        this.log.error("cannot create %s: error %s", filename, err.code);
        return;
      }
    }.bind(this));
  }.bind(this))
  .catch(function(err) {
    this.log.error(err);
  }.bind(this));
};

// ===== Bridge Communication ============================================================

// Send request to Philips Hue bridge.
HueBridge.prototype.request = function(method, resource, body) {
  return new Promise(function(resolve, reject) {
    const requestObj = {
      method: method,
      url: this.url + resource,
      timeout: this.platform.config.timeout,
      json: true
    };
    if (body) {
      requestObj.body = body;
      this.log.debug("%s: hue bridge request: %s %s %j", this.name, method, resource, body);
    } else {
      this.log.debug("%s: hue bridge request: %s %s", this.name, method, resource);
    }
    request(requestObj, function(err, response, responseBody) {
      if (err) {
        if (err.code === "ECONNRESET") {
          this.log.debug("%s: hue bridge communication error %s - retrying in 300ms", this.name, err.code);
          setTimeout(function () {
            resolve(this.request(method, resource, body));
          }.bind(this), 300);
          return;
        }
        this.log.error("%s: hue bridge communication error %s", this.name, err.code);
        return reject(err.code);
      }
      if (response.statusCode != 200) {
        this.log.error("%s: hue bridge status %s", this.name, response.statusCode);
        return reject(response.statusCode);
      }
      // this.log.debug("%s: hue bridge response: %s", this.name, responseBody);
      if (util.isArray(responseBody)) {
        for (const id in responseBody) {
	        const e = responseBody[id].error;
	        if (e) {
	          this.log.error("%s: hue bridge error %d: %s", this.name, e.type, e.description);
            return reject(e.type);
	        }
        }
      }
      return resolve(responseBody);
    }.bind(this));
  }.bind(this));
};
