// homebridge-hue/index.js
// Copyright © 2016-2023 Erik Baauw. All rights reserved.
//
// Homebridge plug-in for Philips Hue.

'use strict'

const HuePlatform = require('./lib/HuePlatform')

module.exports = function (homebridge) {
  homebridge.registerPlatform('homebridge-hue', 'Hue', HuePlatform)
}
