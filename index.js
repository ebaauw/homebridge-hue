// homebridge-hue/index.js
// (C) 2016, Erik Baauw
//
// Homebridge plug-in for Philips Hue.

"use strict";

const dynamic = false;

const HuePlatformModule = require("./lib/HuePlatform");
const HuePlatform = HuePlatformModule.HuePlatform;

module.exports = function(homebridge) {
  HuePlatformModule.setHomebridge(homebridge);
  homebridge.registerPlatform("homebridge-hue", "Hue", HuePlatform, dynamic);
};
