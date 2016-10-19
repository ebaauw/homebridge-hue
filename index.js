// homebridge-hue/index.js
// (C) 2016, Erik Baauw
//
// Homebridge plug-in for Philips Hue.

"use strict";

let dynamic = false;

let HuePlatformModule = require("./lib/HuePlatform");
let HuePlatform = HuePlatformModule.HuePlatform;

module.exports = function(homebridge) {
  HuePlatformModule.setHomebridge(homebridge);
  homebridge.registerPlatform("homebridge-hue", "Hue", HuePlatform, dynamic);
};