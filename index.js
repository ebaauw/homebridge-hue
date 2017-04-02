// homebridge-hue/index.js
// Copyright © 2016, 2017 Erik Baauw. All rights reserved.
//
// Homebridge plug-in for Philips Hue.

'use strict';

const dynamic = false;

const HuePlatformModule = require('./lib/HuePlatform');
const HuePlatform = HuePlatformModule.HuePlatform;

module.exports = function(homebridge) {
  HuePlatformModule.setHomebridge(homebridge);
  homebridge.registerPlatform('homebridge-hue', 'Hue', HuePlatform, dynamic);
};
