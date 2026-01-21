// homebridge-hue/index.js
// Copyright © 2016-2026 Erik Baauw. All rights reserved.
//
// Homebridge plugin for Philips Hue.

import { HuePlatform } from './lib/HuePlatform.js'

function main (homebridge) {
  homebridge.registerPlatform('homebridge-hue', 'Hue', HuePlatform)
}

export { main as default }
