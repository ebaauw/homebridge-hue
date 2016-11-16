// homebridge-hue/lib/HueBridge.js
// (C) 2016, Erik Baauw
//
// Homebridge plugin for Philips Hue.
//
// HueBridge provides support for Philips Hue bridges.

"use strict";

let fs = require("fs");
let os = require("os");
let request = require("request");
let util = require("util");
let deferred = require("deferred");

let HueLightModule = require("./HueLight");
let HueSensorModule = require("./HueSensor");
let HueScheduleModule = require("./HueSchedule");
let HueLight = HueLightModule.HueLight;
let HueSensor = HueSensorModule.HueSensor;
let HueSchedule = HueScheduleModule.HueSchedule;

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

  this.requestCache = [];
  this.requestCacheRunning = false;
  this.openRequestsCount = 0;
  this.requestInterval = null;
}

HueBridge.prototype.getServices = function() {
  return [this.infoService];
};

HueBridge.prototype.accessories = function(callback) {
  var accessoryList = [];
  return this.request("get", "/config", null).then(function(obj) {
    this.name = obj.name;
    this.uuid_base = obj.bridgeid;
    this.username = this.platform.config.users[this.uuid_base] || "";
    this.infoService = new Service.AccessoryInformation();
    this.infoService
      .setCharacteristic(Characteristic.Manufacturer, "homebridge-hue")
      .setCharacteristic(Characteristic.Model, obj.modelid)
      .setCharacteristic(Characteristic.SerialNumber, this.uuid_base);
    accessoryList.push(this);
    if (obj.apiversion != "1.15.0") {
      this.log.error("%s: api version %s instead of 1.15.0", this.name, obj.apiversion);
    }
  }.bind(this))
  .then(this.createUser.bind(this))
  .then(this.mapLights.bind(this, function(id, obj) {
    this.lights[id] = new HueLight(this, id, obj);
    accessoryList.push(this.lights[id]);
  }.bind(this)))
  .then(this.mapGroups.bind(this, function(id, obj) {
    this.groups[id] = new HueLight(this, id, obj, "group");
    accessoryList.push(this.groups[id]);
  }.bind(this)))
  .then(this.mapSensors.bind(this, function(id, obj) {
    this.sensors[id] = new HueSensor(this, id, obj);
    accessoryList.push(this.sensors[id]);
  }.bind(this)))
  .then(this.mapSchedules.bind(this, function(id, obj) {
    this.schedules[id] = new HueSchedule(this, id, obj);
    accessoryList.push(this.schedules[id]);
  }.bind(this)))
  .then(this.mapRules.bind(this, function(id, obj) {
    this.rules[id] = new HueSchedule(this, id, obj, "rule");
    accessoryList.push(this.rules[id]);
  }.bind(this)))
  .catch(function(err) {
  }.bind(this))
  .then(function() {
    this.log.info("%s: found %d accessories", this.name, accessoryList.length);
    while (accessoryList.length > 99) {
      let a = accessoryList.pop();
      this.log.error("%s: too many accessories, ignoring %s %s", this.name, a.type, a.name);
    }
    return callback(accessoryList);
  }.bind(this));
};

HueBridge.prototype.pressLinkButton = function(resolve) {
  this.request("post", "/", "{\"devicetype\":\"homebridge-hue#" + os.hostname() + "\"}")
  .then(function(obj) {
    this.username = obj[0].success.username;
    this.url += "/" + this.username;
    var s = '\n';
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
    }.bind(this), this.platform.config.timeout)
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

HueBridge.prototype.mapLights = function(f) {
  if (!this.platform.config.lights) {
    return Promise.resolve();
  }
  return this.request("get", "/lights", null).then(function(obj) {
    for (let id in obj) {
      if (this.platform.config.alllights || obj[id].manufacturername !== "Philips") {
        f(id, obj[id]);
      }
    }
  }.bind(this));
};

HueBridge.prototype.mapGroups = function(f) {
  if (!this.platform.config.groups) {
    return Promise.resolve();
  }
  return this.request("get", "/groups/0", null).then(function(obj) {
    f(0, obj);
  }.bind(this))
  .then(this.request("get", "/groups", null).then(function(obj) {
    for (let id in obj) {
      if (obj[id].type !== "Room") {
        f(id, obj[id]);
      }
    }
  }.bind(this)));
};

HueBridge.prototype.mapSensors = function(f) {
  if (!this.platform.config.sensors) {
    return Promise.resolve();
  }
  return this.request("get", "/sensors", null).then(function(obj) {
    for (let id in obj) {
      f(id, obj[id]);
    }
  }.bind(this));
};

HueBridge.prototype.mapSchedules = function(f) {
  if (!this.platform.config.schedules) {
    return Promise.resolve();
  }
  return this.request("get", "/schedules", null).then(function(obj) {
    for (let id in obj) {
      f(id, obj[id])
    }
  }.bind(this));
};

HueBridge.prototype.mapRules = function(f) {
  if (!this.platform.config.rules) {
    return Promise.resolve();
  }
  return this.request("get", "/rules", null).then(function(obj) {
    for (let id in obj) {
      f(id, obj[id])
    }
  }.bind(this));
};

// ===== Heartbeat =======================================================================

HueBridge.prototype.heartbeat = function() {
  return this.mapSensors(function(id, obj) {
    let a = this.sensors[id];
    if (a) {
      a.heartbeat(obj);
    }
  }.bind(this))
  .then(this.mapRules.bind(this, function(id, obj) {
    let a = this.rules[id];
    if (a) {
      a.heartbeat(obj);
    }
  }.bind(this)))
  .then(this.mapGroups.bind(this, function(id, obj) {
    let a = this.groups[id];
    if (a) {
      a.heartbeat(obj);
    }
  }.bind(this)))
  .then(this.mapLights.bind(this, function(id, obj) {
    let a = this.lights[id];
    if (a) {
      a.heartbeat(obj);
    }
  }.bind(this)))
  .then(this.mapSchedules.bind(this, function(id, obj) {
    let a = this.schedules[id];
    if (a) {
      a.heartbeat(obj);
    }
  }.bind(this)))
  .catch(function (err) {
  }.bind(this));
};

// ===== Homekit Events ==================================================================

HueBridge.prototype.identify = function(callback) {
  this.log.info("%s: identify", this.name);
  this.request("get", "/", null)
  .then(function(body) {
    let obj = {};
    obj.lights = body.lights;
    obj.groups = body.groups;
    obj.sensors = body.sensors;
    obj.config = body.config;
    let whitelist = {};
    let userid = 0;
    for (let username in body.config.whitelist) {
      userid += 1;
      const key = "***" + userid + "***";
      whitelist[key] = body.config.whitelist[username];
    }
    obj.config.whitelist = whitelist;
    const filename = "state_" + this.uuid_base + ".json";
    const json = JSON.stringify(obj);
    fs.writeFile(filename, json);
    this.log.info("%s: bridge state dumped to %s", this.name, filename);
  }.bind(this))
  .catch(function(err) {
    this.log.error(err);
  }.bind(this));
  return callback();
};

// ===== Bridge Communication ============================================================

// Send request to Philips Hue bridge.
HueBridge.prototype.request = function(method, resource, body) {
    let defPromise = deferred();
    let requestCacheItem = {
        method: method,
        resource: resource,
        body: body,
        defPromise: defPromise
    };
    this.log.debug("%s: hue bridge adding request to cache: %s", this.name, resource);
    this.requestCache.push(requestCacheItem);
    if (this.requestInterval === null) {
        this.log.debug("%s: hue bridge starting request cache poling", this.name);
        this.requestInterval = setInterval(this.runCache.bind(this), 100);
    }
    return defPromise.promise;
};

// Handle Hue requests cache
HueBridge.prototype.runCache = function() {
    if (this.requestCacheRunning) {
        return;
    } else {
        this.requestCacheRunning = true;
        if (this.requestCache.length > 0 && this.openRequestsCount < this.platform.config.maxopenrequests) {
            let availableRequestSlots = (this.platform.config.maxopenrequests - this.openRequestsCount);
            availableRequestSlots = (this.requestCache.length < availableRequestSlots) ?
                this.requestCache.length : availableRequestSlots;
            this.log.debug("%s: available request slots: %s", this.name, availableRequestSlots);

            for (var i = 0; i < availableRequestSlots; i++) {
                let cacheItem = this.requestCache.shift();
                this.openRequestsCount++;
                let requestObj = {
                    method: cacheItem.method,
                    url: this.url + cacheItem.resource,
                    timeout: this.platform.config.timeout
                };
                var requestString = cacheItem.method + " " + cacheItem.resource;
                if (cacheItem.body) {
                    requestObj.body = cacheItem.body;
                    requestString += " '" + cacheItem.body + "'";
                }
                cacheItem.name = requestString;
                this.log.debug("%s: hue bridge request: %s", this.name, requestString);
                request(requestObj, function (err, response, responseBody) {
                    this.openRequestsCount--;
                    if (err) {
                        this.log.error("%s: hue bridge communication error %s", this.name, err);
                        return cacheItem.defPromise.reject(err);
                    }
                    if (response.statusCode != 200) {
                        this.log.error("%s: hue bridge status %s", this.name, response.statusCode);
                        return cacheItem.defPromise.reject(err);
                    }
                    // this.log.debug("%s: hue bridge response: %s", this.name, responseBody);
                    var obj;
                    try {
                        obj = JSON.parse(responseBody);
                    } catch (e) {
                        this.log.error("%s: hue bridge returned invalid json (%s)", this.name, e);
                        return cacheItem.defPromise.reject(e);
                    }
                    if (util.isArray(obj)) {
                        for (let id in obj) {
                            let e = obj[id].error;
                            if (e) {
                                this.log.error("%s: hue bridge error %d: %s", this.name, e.type, e.description);
                                return cacheItem.defPromise.reject(e.type);
                            }
                        }
                    }
                    this.log.debug("%s: hue bridge request resolved: %s", this.name, cacheItem.name);
                    return cacheItem.defPromise.resolve(obj);
                }.bind(this));
            }
        }
        this.requestCacheRunning = false;
    }
};
