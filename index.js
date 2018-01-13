// homebridge-hue/index.js
// Copyright © 2016-2018 Erik Baauw. All rights reserved.
//
// Homebridge plug-in for Philips Hue and/or deCONZ.

'use strict'

const HuePlatformModule = require('./lib/HuePlatform')
const HuePlatform = HuePlatformModule.HuePlatform

module.exports = function (homebridge) {
  HuePlatformModule.setHomebridge(homebridge)
  homebridge.registerPlatform('homebridge-hue', 'Hue', HuePlatform)
}
