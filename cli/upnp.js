#!/usr/bin/env node

// homebridge-hue/cli/upnp.js
// Copyright © 2019-2020 Erik Baauw. All rights reserved.
//
// Homebridge plugin for Philips Hue and/or deCONZ.

'use strict'

const homebridgeLib = require('homebridge-lib')

new homebridgeLib.UpnpCommand().main()
