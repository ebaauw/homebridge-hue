// homebridge-hue/index.js
// Copyright © 2016-2025 Erik Baauw. All rights reserved.
//
// Homebridge plug-in for Philips Hue.

import { HuePlatform } from './lib/HuePlatform.js'

function main (homebridge) {
  homebridge.registerPlatform('homebridge-hue', 'Hue', HuePlatform)
}

export { main as default }
