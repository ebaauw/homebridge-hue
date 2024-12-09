// homebridge-hue/lib/HueLight.js
// Copyright © 2016-2024 Erik Baauw. All rights reserved.
//
// Homebridge plug-in for Philips Hue.

import { formatError } from 'homebridge-lib'
/* eslint-disable no-unused-vars */
import { Platform } from 'homebridge-lib/Platform'
import { AccessoryDelegate } from 'homebridge-lib/AccessoryDelegate'
/* eslint-ensable no-unused-vars */
import { AdaptiveLighting } from 'homebridge-lib/AdaptiveLighting'
import { Colour } from 'homebridge-lib/Colour'

const { defaultGamut, xyToHsv, hsvToXy, ctToXy } = Colour

const knownLights = {
  '3A Smart Home DE': { // Issue #883.
  },
  'Busch-Jaeger': {
    // See: https://www.busch-jaeger.de/en/products/product-solutions/dimmer/busch-radio-controlled-dimmer-zigbee-light-link/
    models: {
      RM01: { // 6715 U-500 with 6736-84
        fix: function () { // Issue #241
          if (this.config.bri && this.obj.type === 'On/Off light') {
            this.log.debug(
              '%s: %s: ignoring state.bri for %s', this.bridge.name,
              this.resource, this.obj.type
            )
            this.config.bri = false
          }
        }
      }
    }
  },
  'dresden elektronik': {
    // See: https://www.dresden-elektronik.de/funktechnik/solutions/wireless-light-control/wireless-ballasts/?L=1
    computesXy: true
  },
  FeiBit: {
    models: {
      'FNB56-SKT1EHG1.2': {
        fix: function () { // issue #361
          this.obj.type = 'On/Off plug-in unit'
        }
      }
    }
  },
  'Feibit Inc co.': { // Issue #171
  },
  GLEDOPTO: {
    // See: https://www.led-trading.de/zigbee-kompatibel-controller-led-lichtsteuerung
    gamut: {
      r: [0.7006, 0.2993],
      g: [0.1387, 0.8148],
      b: [0.1510, 0.0227]
    },
    models: {
      'GL-C-007': {
        fix: function () {
          this.config.waitTimeUpdate = 0
        }
      },
      'GL-C-008': {
        fix: function () {
          this.config.waitTimeUpdate = 0
        }
      },
      GLEDOPTO: { // Issue #244
        fix: function () {
          if (
            this.subtype === '0a' &&
            this.obj.type === 'Dimmable light' &&
            this.version === '1.0.2'
          ) {
            this.model = 'RGBW'
          } else if (
            this.subtype === '0b' &&
            this.obj.type === 'Color temperature light' &&
            this.version === '1.3.002'
          ) {
            this.model = 'WW/CW'
          } else if (
            this.subtype === '0b' &&
            this.obj.type === 'Extended color light' &&
            this.version === '1.0.2'
          ) {
            this.model = 'RGB+CCT'
            if (this.accessory.resources.lights.other.length > 1) {
              this.model = 'RGBW'
              this.config.ct = false
            }
          } else {
            this.log.warn(
              '%s: %s: unknown light model %j', this.bridge.name,
              this.resource, this.obj
            )
            return
          }
          this.log.debug(
            '%s: %s: set model to %j', this.bridge.name,
            this.resource, this.model
          )
        }
      }
    }
  },
  icasa: {
  },
  'IKEA of Sweden': {
    // See: http://www.ikea.com/us/en/catalog/categories/departments/lighting/smart_lighting/
    gamut: defaultGamut, // Issue #956
    noTransition: true,
    models: {
      '': { // Hue bridge chokes on non-printable character
        fix: function () {
          this.model = 'TRADFRI bulb E27 WS opal 980lm'
          this.log.debug(
            '%s: %s: set model to %j', this.bridge.name,
            this.resource, this.model
          )
        }
      },
      'TRADFRI bulb E27 CWS 806lm': {
        computesXy: true,
        gamut: {
          r: [0.68, 0.31],
          g: [0.11, 0.82],
          b: [0.13, 0.04]
        },
        fix: function () {
          if (this.obj.swversion === '1.0.021') {
            this.config.noTransition = false
          }
        }
      }
    }
  },
  innr: {
    // See: https://shop.innrlighting.com/en/shop
    gamut: { // Issue #152
      r: [0.8817, 0.1033],
      g: [0.2204, 0.7758],
      b: [0.0551, 0.1940]
    },
    models: {
      'DL 110': { noAlert: true }, // Spot
      'FL 110': { noAlert: true }, // Flex Light
      'PL 110': { noAlert: true }, // Puck Light
      'SL 110 M': { noAlert: true }, // Spot, issue #166
      'SL 110 N': { noAlert: true }, // Spot, issue #166
      'SL 110 W': { noAlert: true }, // Spot, issue #166
      'SP 120': { fix: function () { this.config.bri = false } }, // smart plug
      'ST 110': { noAlert: true }, // Strip
      'UC 110': { noAlert: true } // Under Cabinet
    }
  },
  LEDVANCE: {
    gamut: {
      r: [0.6972, 0.3027],
      g: [0.1737, 0.6991],
      b: [0.1227, 0.0959]
    }
  },
  MLI: { // Issue #439
    gamut: {
      r: [0.68, 0.31],
      g: [0.11, 0.82],
      b: [0.13, 0.04]
    }
  },
  'Neuhaus Lighting Group': { // Issue #850
  },
  'Neuhaus Lighting Group ': { // Issue #455
  },
  OSRAM: {
    gamut: {
      r: [0.6850, 0.3149],
      g: [0.1780, 0.7253],
      b: [0.1241, 0.0578]
    },
    fix: function () {
      if (this.obj.swversion === 'V1.03.07') {
        this.config.noTransition = true
      }
    }
  },
  'Paulmann Licht': { // Issue #1041
  },
  Pee: { // Issue #217
  },
  ShenZhen_Homa: { // PR #234, issue #235
  },
  'Signify Netherlands B.V.': {
    // See: http://www.developers.meethue.com/documentation/supported-lights
    gamuts: { // Color gamut per light model.
      A: { // Color Lights
        r: [0.7040, 0.2960],
        g: [0.2151, 0.7106],
        b: [0.1380, 0.0800]
      },
      B: { // Extended Color Lights
        r: [0.6750, 0.3220],
        g: [0.4090, 0.5180],
        b: [0.1670, 0.0400]
      },
      C: { // next gen Extended Color Lights
        r: [0.6920, 0.3080],
        g: [0.1700, 0.7000],
        b: [0.1530, 0.0480]
      }
    },
    computesXy: true,
    fix: function () {
      this.manufacturer = 'Signify Netherlands B.V.'
    },
    models: {
      LLC001: { // Living Colors Gen1 Iris
        fix: function () {
          if (this.obj.uniqueid === 'ff:ff:ff:ff:ff:ff:ff:ff-0b') {
            this.serialNumber = this.bridge.serialNumber + '-L' + this.id
          }
          this.config.xy = false
          this.config.hs = true
        },
        noWallSwitch: true
      },
      LCT001: { gamut: 'B' }, // Hue bulb A19
      LCT002: { gamut: 'B' }, // Hue Spot BR30
      LCT003: { gamut: 'B' }, // Hue Spot GU10
      LCT007: { gamut: 'B' }, // Hue bulb A19
      LCT010: { gamut: 'C' }, // Hue bulb A19
      LCT011: { gamut: 'C' }, // Hue BR30
      LCT012: { gamut: 'C' }, // Hue Color Candle
      LCT014: { gamut: 'C' }, // Hue bulb A19
      LCT015: { gamut: 'C' }, // Hue bulb A19
      LCT016: { gamut: 'C' }, // Hue bulb A19
      LLC005: { gamut: 'A' }, // Living Colors Gen3 Bloom, Aura
      LLC006: { gamut: 'A' }, // Living Colors Gen3 Iris
      LLC007: { gamut: 'A' }, // Living Colors Gen3 Bloom, Aura
      LLC010: { gamut: 'A' }, // Hue Living Colors Iris
      LLC011: { gamut: 'A' }, // Hue Living Colors Bloom
      LLC012: { gamut: 'A' }, // Hue Living Colors Bloom
      LLC013: { gamut: 'A' }, // Disney Living Colors
      LLC014: { gamut: 'A' }, // Living Colors Gen3 Bloom, Aura
      LLC020: { gamut: 'C' }, // Hue Go
      LLM001: { gamut: 'B' }, // Color Light Module
      LST001: { gamut: 'A' }, // Hue LightStrips
      LST002: { gamut: 'C' } // Hue LightStrips Plus
    }
  },
  _TZE200_s8gkrkxk: { // LIDL Xmas lightstrip
    fix: function () {
      this.manufacturer = 'LIDL Livarno Lux'
      this.model = 'HG06467'
      this.config.colorLoop = false
      this.config.hs = true
    }
  }
}

knownLights.Philips = knownLights['Signify Netherlands B.V.']

const noResponse = new Error('No Response')
noResponse.toString = () => { return noResponse.message }

let Service
let Characteristic
let my

class HueLight {
  static setHomebridge (homebridge, _my, _eve) {
    Service = homebridge.hap.Service
    Characteristic = homebridge.hap.Characteristic
    my = _my
  }

  constructor (accessory, id, obj, type = 'light') {
    this.accessory = accessory
    this.id = id
    this.obj = obj
    this.type = type
    this.log = this.accessory.log
    this.serialNumber = this.accessory.serialNumber
    this.bridge = this.accessory.bridge
    this.name = obj.name
    this.resource = '/' + this.type + 's/' + this.id
    this.key = this.type === 'group' ? 'action' : 'state'
    this.resourcePath = this.resource + '/' + this.key
    this.desiredState = {}
    this.deferrals = []
    for (const key in this.obj.action) {
      if (key !== 'on') {
        this.obj.state[key] = this.obj.action[key]
      }
    }
    this.hk = {}

    this.setConfig()
    this.infoService = this.accessory.getInfoService(this)
    if (this.config.outlet) {
      this.service = new Service.Outlet(this.name, this.subtype)
      this.service.getCharacteristic(Characteristic.OutletInUse)
        .updateValue(1)
    } else if (this.config.switch) {
      this.service = new Service.Switch(this.name, this.subtype)
    } else if (this.config.valve) {
      this.service = new Service.Valve(this.name, this.subtype)
      this.service.getCharacteristic(Characteristic.InUse)
        .updateValue(0)
      this.service.getCharacteristic(Characteristic.ValveType)
        .updateValue(Characteristic.ValveType.GENERIC_VALVE)
    } else {
      this.service = new Service.Lightbulb(this.name, this.subtype)
    }
    if (this.config.valve) {
      this.service.getCharacteristic(Characteristic.Active)
        .on('get', this.getActive.bind(this))
        .on('set', this.setActive.bind(this))
      this.checkActive(this.obj.state.on)
      this.hk.duration = 0
      this.service.getCharacteristic(Characteristic.SetDuration)
        .setProps({ maxValue: 4 * 3600 })
        .updateValue(this.hk.duration)
        .on('set', this.setDuration.bind(this))
      this.hk.autoInActive = 0
      this.service.getCharacteristic(Characteristic.RemainingDuration)
        .setProps({ maxValue: 4 * 3600 })
        .updateValue(0)
        .on('get', this.getRemainingDuration.bind(this))
    } else {
      this.service.getCharacteristic(Characteristic.On)
        .on('get', this.getOn.bind(this))
        .on('set', this.setOn.bind(this))
      if (this.type === 'group') {
        if (this.bridge.platform.config.anyOn) {
          this.anyOnKey = 'any_on'
          this.AnyOnCharacteristic = my.Characteristics.AnyOn
          this.service.addOptionalCharacteristic(this.AnyOnCharacteristic)
          this.service.getCharacteristic(this.AnyOnCharacteristic)
            .on('set', this.setAnyOn.bind(this))
          this.checkAllOn(this.obj.state.all_on)
        } else {
          this.anyOnKey = 'on'
          this.AnyOnCharacteristic = Characteristic.On
          this.checkAllOn = () => {}
        }
        this.checkAnyOn(this.obj.state.any_on)
        if (this.config.streaming) {
          this.service.addOptionalCharacteristic(my.Characteristics.Streaming)
          this.service.getCharacteristic(my.Characteristics.Streaming)
            .on('set', this.setStreaming.bind(this))
          this.checkStreaming(this.obj.stream.active)
        }
      } else {
        this.checkOn(this.obj.state.on)
      }
      if (this.config.bri) {
        this.service.getCharacteristic(Characteristic.Brightness)
          .on('set', this.setBri.bind(this))
        this.checkBri(this.obj.state.bri)

        this.service.addOptionalCharacteristic(my.Characteristics.BrightnessChange)
        this.service.getCharacteristic(my.Characteristics.BrightnessChange)
          .updateValue(0)
          .on('set', this.setBriChange.bind(this))
      }
      if (this.config.ct) {
        this.colorTemperatureCharacteristic = Characteristic.ColorTemperature
        this.service.addOptionalCharacteristic(Characteristic.ColorTemperature)
        this.service.getCharacteristic(Characteristic.ColorTemperature)
          .updateValue(this.config.minCt)
          .setProps({
            minValue: this.config.minCt,
            maxValue: this.config.maxCt
          })
          .on('set', this.setCt.bind(this))
        this.checkCt(this.obj.state.ct)

        this.service.addOptionalCharacteristic(
          Characteristic.SupportedCharacteristicValueTransitionConfiguration
        )
        this.service.getCharacteristic(
          Characteristic.SupportedCharacteristicValueTransitionConfiguration
        )
          .on('get', this.getSupportedTransitionConfiguration.bind(this))
        this.service.addOptionalCharacteristic(
          Characteristic.CharacteristicValueTransitionControl
        )
        this.service.getCharacteristic(
          Characteristic.CharacteristicValueTransitionControl
        )
          .on('get', this.getTransitionControl.bind(this))
          .on('set', this.setTransitionControl.bind(this))
        this.service.addOptionalCharacteristic(
          Characteristic.CharacteristicValueActiveTransitionCount
        )
        this.service.getCharacteristic(
          Characteristic.CharacteristicValueActiveTransitionCount
        )
          .updateValue(0)
      }
      if (this.config.xy || this.config.hs) {
        this.service.getCharacteristic(Characteristic.Hue)
          .on('set', this.setHue.bind(this))
        this.service.getCharacteristic(Characteristic.Saturation)
          .on('set', this.setSat.bind(this))
        if (this.config.xy) {
          this.checkXy(this.obj.state.xy)
        } else {
          this.checkHue(this.obj.state.hue)
          this.checkSat(this.obj.state.sat)
        }
      }
      if (this.config.colorLoop) {
        this.service.addOptionalCharacteristic(my.Characteristics.ColorLoop)
        this.service.getCharacteristic(my.Characteristics.ColorLoop)
          .on('set', this.setColorLoop.bind(this))
      }
    }
    if (this.bridge.platform.config.configuredName) {
      this.service.addCharacteristic(Characteristic.ConfiguredName)
    }
    if (this.type === 'light') {
      this.service.addOptionalCharacteristic(Characteristic.StatusFault)
      this.checkReachable(this.obj.state.reachable)
      // if (this.bridge.config.nativeHomeKitLights) {
      //   this.service.addOptionalCharacteristic(my.Characteristics.UniqueID)
      //   this.service.getCharacteristic(my.Characteristics.UniqueID)
      //     .updateValue(this.obj.uniqueid)
      // }
    }
    if (this.bridge.platform.config.resource) {
      this.service.addOptionalCharacteristic(my.Characteristics.Resource)
      this.service.getCharacteristic(my.Characteristics.Resource)
        .updateValue(this.resource)
    }
  }

  // Store configuration to this.config.
  setConfig () {
    for (const key in this.obj.action) {
      if (key !== 'on') {
        this.obj.state[key] = this.obj.action[key]
      }
    }
    this.config = {
      on: this.obj.state.on !== undefined || this.obj.state.any_on !== undefined,
      bri: this.obj.state.bri !== undefined,
      ct: this.obj.state.ct !== undefined,
      xy: this.obj.state.xy !== undefined,
      alert: this.obj.state.alert !== undefined,
      colorLoop: this.obj.state.effect !== undefined,
      wallSwitch: false,
      resetTimeout: this.bridge.platform.config.resetTimeout,
      waitTimeUpdate: this.bridge.platform.config.waitTimeUpdate
    }
    if (this.bridge.outlet[this.type + 's'][this.id]) {
      this.config.outlet = true
    } else if (this.bridge.switch[this.type + 's'][this.id]) {
      this.config.switch = true
    } else if (this.type === 'light' && this.bridge.valve[this.id]) {
      this.config.valve = true
    }
    if (this.config.outlet || this.config.switch || this.config.valve) {
      this.config.bri = false
      this.config.ct = false
      this.config.xy = false
    } else if (this.type === 'light') {
      this.config.wallSwitch = this.bridge.platform.config.wallSwitch ||
        this.bridge.wallswitch[this.id]
    }
    if (this.config.ct) {
      // Default colour temperature range: 153 (~6500K) - 500 (2000K).
      this.config.minCt = 153
      this.config.maxCt = 500
    }
    if (this.config.xy) {
      this.config.gamut = defaultGamut
    }
    if (this.type === 'group') {
      this.manufacturer = this.bridge.obj.manufacturername
      this.model = this.obj.type
      if (this.accessory.isMulti) {
        this.subtype = 'G' + this.id
      }
      this.version = this.bridge.version
      if (this.obj.type === 'Entertainment') {
        this.config.streaming = true
      }
      this.log.debug('%s: %s: config: %j', this.bridge.name, this.resource, this.config)
      return
    }
    this.manufacturer = this.obj.manufacturername
    this.model = this.obj.modelid
    if (this.accessory.isMulti) {
      this.subtype = 'L' + this.id
    } else {
      this.subtype = this.obj.uniqueid.split('-')[1]
    }
    this.version = this.obj.swversion
    this.config.unknown = knownLights[this.obj.manufacturername] == null
    const manufacturer = knownLights[this.obj.manufacturername] || {}
    manufacturer.models = manufacturer.models || {}
    const model = manufacturer.models[this.obj.modelid] || {}
    if (typeof model.fix === 'function') {
      model.fix.call(this)
    } else if (typeof manufacturer.fix === 'function') {
      manufacturer.fix.call(this)
    }
    if (this.config.ct) {
      if (model.minCt != null) {
        // whitelisted model
        this.config.minCt = model.minCt
      } else if (manufacturer.minCt != null) {
        // whitelisted manufacturer default
        this.config.minCt = manufacturer.minCt
      } else if (
        this.obj.capabilities != null && this.obj.capabilities.control != null &&
        this.obj.capabilities.control.ct != null &&
        this.obj.capabilities.control.ct.min !== 0
      ) {
        // reported by Hue bridge
        this.config.minCt = this.obj.capabilities.control.ct.min
      }
      if (model.maxCt != null) {
        // whitelisted model
        this.config.maxCt = model.maxCt
      } else if (manufacturer.maxCt != null) {
        // whitelisted manufacturer default
        this.config.maxCt = manufacturer.maxCt
      } else if (
        this.obj.capabilities != null && this.obj.capabilities.control != null &&
        this.obj.capabilities.control.ct != null &&
        this.obj.capabilities.control.ct.max !== 0 &&
        this.obj.capabilities.control.ct.max !== 65535
      ) {
        // reported by Hue bridge
        this.config.maxCt = this.obj.capabilities.control.ct.max
      } else if (this.config.unknown) {
        this.log.warn(
          '%s: %s: warning: using default colour temperature range for unknown light model %j',
          this.bridge.name, this.resource, this.obj
        )
      }
    }
    if (this.config.xy) {
      if (
        model.gamut != null && manufacturer.gamuts != null &&
        manufacturer.gamuts[model.gamut] != null
      ) {
        // whitelisted model
        this.config.gamut = manufacturer.gamuts[model.gamut]
      } else if (model.gamut != null) {
        this.config.gamut = model.gamut
      } else if (manufacturer.gamut != null) {
        // whitelisted manufacturer default
        this.config.gamut = manufacturer.gamut
      } else if (
        this.obj.capabilities != null && this.obj.capabilities.control != null &&
        this.obj.capabilities.control.colorgamut != null
      ) {
        // reported by Hue bridge
        const gamut = this.obj.capabilities.control.colorgamut
        this.config.gamut = {
          r: [
            Math.min(gamut[0][0], defaultGamut.r[0]),
            Math.max(gamut[0][1], defaultGamut.r[1])
          ],
          g: [
            Math.max(gamut[1][0], defaultGamut.g[0]),
            Math.min(gamut[1][1], defaultGamut.g[1])
          ],
          b: [
            Math.max(gamut[2][0], defaultGamut.b[0]),
            Math.max(gamut[2][1], defaultGamut.b[1])
          ]
        }
      } else if (this.config.unknown) {
        this.log.warn(
          '%s: %s: warning: using default colour gamut for unknown light model %j',
          this.bridge.name, this.resource, this.obj
        )
      }
      if (model.computesXy) {
        this.config.computesXy = model.computesXy
      } else if (manufacturer.computesXy) {
        this.config.computesXy = manufacturer.computesXy
      }
    }
    if (model.noAlert) {
      this.config.noAlert = true
    }
    if (model.noTransition) {
      this.config.noTransition = model.noTransition
    } else if (manufacturer.noTransition) {
      this.config.noTransition = manufacturer.noTransition
    }
    if (model.noWallSwitch) {
      this.config.wallSwitch = false
    }
    this.log.debug('%s: %s: config: %j', this.bridge.name, this.resource, this.config)
  }

  // ===== Bridge Events =========================================================

  heartbeat (beat, obj) {
    if (this.updating) {
      return
    }
    // this.checkName(obj.name)
    for (const key in obj.action) {
      if (key !== 'on') {
        obj.state[key] = obj.action[key]
      }
    }
    this.checkState(obj.state)
    if (this.config.streaming) {
      this.checkStreaming(obj.stream.active)
    }
    if (beat % 60 === 0) {
      this.checkAdaptiveLighting()
    }
  }

  checkState (state, event) {
    for (const key in state) {
      switch (key) {
        case 'alert':
          break
        case 'all_on':
          this.checkAllOn(state.all_on)
          break
        case 'any_on':
          this.checkAnyOn(state.any_on)
          break
        case 'bri':
          this.checkBri(state.bri)
          break
        case 'colormode':
          this.obj.state.colormode = state.colormode
          break
        case 'ct':
          this.checkCt(state.ct)
          break
        case 'effect':
          this.checkEffect(state.effect)
          break
        case 'hue':
          this.checkHue(state.hue)
          break
        case 'mode':
          break
        case 'on':
          if (this.config.valve) {
            this.checkActive(state.on)
          } else {
            this.checkOn(state.on)
          }
          break
        case 'reachable':
          this.checkReachable(state.reachable)
          break
        case 'sat':
          this.checkSat(state.sat)
          break
        case 'scene':
          break
        case 'xy':
          this.checkXy(state.xy)
          break
        default:
          this.log.debug(
            '%s: ignore unknown attribute state.%s', this.name, key
          )
          break
      }
    }
  }

  checkOn (on) {
    if (this.obj.state.on !== on) {
      this.log.debug(
        '%s: %s on changed from %s to %s', this.name, this.type,
        this.obj.state.on, on
      )
      this.obj.state.on = on
    }
    if (this.config.doorLock) {
      const hkLockState = on
        ? Characteristic.LockCurrentState.SECURED
        : Characteristic.LockCurrentState.UNSECURED
      if (this.hk.lockCurrentState !== hkLockState) {
        if (this.hk.lockCurrentState !== undefined) {
          this.log.info(
            '%s: set homekit lock current state from %s to %s', this.name,
            this.hk.lockCurrentState, hkLockState
          )
        }
      }
      this.hk.lockCurrentState = hkLockState
      this.service.getCharacteristic(Characteristic.LockCurrentState)
        .updateValue(this.hk.lockCurrentState)
      return
    }
    let hkOn
    if (this.config.wallSwitch && !this.obj.state.reachable) {
      if (this.hk.on) {
        this.log.info('%s: not reachable: force homekit on to false', this.name)
      }
      hkOn = false
    } else {
      hkOn = this.obj.state.on
    }
    if (this.hk.on !== hkOn) {
      if (this.hk.on !== undefined) {
        this.log.info(
          '%s: set homekit on from %s to %s', this.name,
          this.hk.on, hkOn
        )
      }
      this.hk.on = hkOn
      this.service.getCharacteristic(Characteristic.On)
        .updateValue(this.hk.on)
      this.checkAdaptiveLighting()
    }
  }

  checkAllOn (allOn) {
    if (this.obj.state.all_on !== allOn) {
      this.log.debug(
        '%s: %s all_on changed from %s to %s', this.name, this.type,
        this.obj.state.all_on, allOn
      )
      this.obj.state.all_on = allOn
    }
    const hkOn = this.obj.state.all_on
    if (this.hk.on !== hkOn) {
      if (this.hk.on !== undefined) {
        this.log.info(
          '%s: set homekit on from %s to %s', this.name,
          this.hk.on, hkOn
        )
      }
      this.hk.on = hkOn
      this.service.getCharacteristic(Characteristic.On)
        .updateValue(this.hk.on)
    }
  }

  checkAnyOn (anyOn) {
    if (this.obj.state[this.anyOnKey] !== anyOn) {
      this.log.debug(
        '%s: %s any_on changed from %s to %s', this.name, this.type,
        this.obj.state[this.anyOnKey], anyOn
      )
      this.obj.state[this.anyOnKey] = anyOn
    }
    const hkAnyOn = this.obj.state[this.anyOnKey]
    if (this.hk[this.anyOnKey] !== hkAnyOn) {
      if (this.hk[this.anyOnKey] !== undefined) {
        this.log.info(
          '%s: set homekit any on from %s to %s', this.name,
          this.hk[this.anyOnKey], hkAnyOn
        )
      }
      this.hk[this.anyOnKey] = hkAnyOn
      this.service.getCharacteristic(this.AnyOnCharacteristic)
        .updateValue(this.hk[this.anyOnKey])
    }
  }

  checkStreaming (streaming) {
    if (this.obj.state.streaming !== streaming) {
      this.log.debug(
        '%s: streaming changed from %s to %s', this.name,
        this.obj.state.streaming, streaming
      )
      this.obj.state.streaming = streaming
    }
    const hkStreaming = this.obj.state.streaming
    if (this.hk.streaming !== hkStreaming) {
      if (this.hk.streaming !== undefined) {
        this.log.info(
          '%s: set homekit streaming from %s to %s', this.name,
          this.hk.streaming, hkStreaming
        )
      }
      this.hk.streaming = hkStreaming
      this.service.getCharacteristic(my.Characteristics.Streaming)
        .updateValue(this.hk.streaming)
    }
  }

  checkActive (on) {
    if (this.obj.state.on !== on) {
      this.log.debug(
        '%s: %s on changed from %s to %s', this.name, this.type,
        this.obj.state.on, on
      )
      this.obj.state.on = on
    }
    const hkActive = this.obj.state.on
      ? Characteristic.Active.ACTIVE
      : Characteristic.Active.INACTIVE
    if (this.hk.active !== hkActive) {
      if (this.hk.active !== undefined) {
        this.log.info(
          '%s: set homekit active from %s to %s', this.name,
          this.hk.active, hkActive
        )
      }
      this.hk.active = hkActive
      this.service.getCharacteristic(Characteristic.Active)
        .updateValue(this.hk.active)
      this.didSetActive()
    }
  }

  checkBri (bri) {
    if (!this.config.bri) {
      return
    }
    if (this.obj.state.bri !== bri) {
      this.log.debug(
        '%s: %s bri changed from %s to %s', this.name, this.type,
        this.obj.state.bri, bri
      )
      if (this.recentlyUpdated) {
        this.log.debug('%s: recently updated - ignore changed bri', this.name)
        return
      }
      this.obj.state.bri = bri
    }
    const hkBri = Math.round(this.obj.state.bri * 100.0 / 254.0)
    if (this.hk.bri !== hkBri) {
      if (this.hk.bri !== undefined) {
        this.log.info(
          '%s: set homekit brightness from %s%% to %s%%', this.name,
          this.hk.bri, hkBri
        )
      }
      this.hk.bri = hkBri
      this.service.getCharacteristic(Characteristic.Brightness)
        .updateValue(this.hk.bri)
      this.checkAdaptiveLighting()
    }
  }

  checkCt (ct) {
    if (!this.config.ct || this.obj.state.colormode !== 'ct') {
      return
    }
    if (this.obj.state.ct !== ct) {
      this.log.debug(
        '%s: %s ct changed from %s to %s', this.name, this.type,
        this.obj.state.ct, ct
      )
      // this.disableAdaptiveLighting()
      if (this.recentlyUpdated) {
        this.log.debug('%s: recently updated - ignore changed ct', this.name)
        return
      }
      this.obj.state.ct = ct
    }
    const hkCt = Math.max(this.config.minCt, Math.min(this.config.maxCt, ct))
    if (this.hk.ct !== hkCt) {
      if (this.hk.ct !== undefined) {
        this.log.info(
          '%s: set homekit color temperature from %s mired to %s mired',
          this.name, this.hk.ct, hkCt
        )
      }
      this.hk.ct = hkCt
      this.service.getCharacteristic(Characteristic.ColorTemperature)
        .updateValue(this.hk.ct)
    }
  }

  checkHue (hue) {
    if (!this.config.hs || this.obj.state.colormode !== 'hs') {
      return
    }
    if (this.obj.state.hue !== hue) {
      this.log.debug(
        '%s: %s hue changed from %s to %s', this.name, this.type,
        this.obj.state.hue, hue
      )
      this.obj.state.hue = hue
    }
    const hkHue = Math.round(this.obj.state.hue * 360.0 / 65535.0)
    if (this.hk.hue !== hkHue) {
      if (this.hk.hue !== undefined) {
        this.log.info(
          '%s: set homekit hue from %s˚ to %s˚', this.name,
          this.hk.hue, hkHue
        )
      }
      this.hk.hue = hkHue
      this.service.getCharacteristic(Characteristic.Hue)
        .updateValue(this.hk.hue)
    }
  }

  checkSat (sat) {
    if (!this.config.hs || this.obj.state.colormode !== 'hs') {
      return
    }
    if (this.obj.state.sat !== sat) {
      this.log.debug(
        '%s: %s sat changed from %s to %s', this.name, this.type,
        this.obj.state.sat, sat
      )
      this.obj.state.sat = sat
    }
    const hkSat = Math.round(this.obj.state.sat * 100.0 / 254.0)
    if (this.hk.sat !== hkSat) {
      if (this.hk.sat !== undefined) {
        this.log.info(
          '%s: set homekit saturation from %s%%to %s%%', this.name,
          this.hk.sat, hkSat
        )
      }
      this.hk.sat = hkSat
      this.service.getCharacteristic(Characteristic.Saturation)
        .updateValue(this.hk.sat)
    }
  }

  checkEffect (effect) {
    if (!this.config.colorLoop) {
      return
    }
    if (this.obj.state.effect !== effect) {
      this.log.debug(
        '%s: %s effect changed from %s to %s', this.name, this.type,
        this.obj.state.effect, effect
      )
      this.disableAdaptiveLighting()
      this.obj.state.effect = effect
    }
    if (this.config.colorLoop) {
      const hkColorloop = effect === 'colorloop'
      if (this.hk.colorLoop !== hkColorloop) {
        if (this.hk.colorLoop !== undefined) {
          this.log.info(
            '%s: set homekit color loop from %s to %s', this.name,
            this.hk.colorLoop, hkColorloop
          )
        }
        this.hk.colorLoop = hkColorloop
        this.service.getCharacteristic(my.Characteristics.ColorLoop)
          .updateValue(this.hk.colorLoop)
      }
    }
  }

  checkReachable (reachable) {
    if (this.obj.state.reachable !== reachable) {
      this.log.debug(
        '%s: %s reachable changed from %j to %j', this.name, this.type,
        this.obj.state.reachable, reachable
      )
      this.obj.state.reachable = reachable
    }
    const hkFault = this.obj.state.reachable ? 0 : 1
    if (this.hk.fault !== hkFault) {
      if (this.hk.fault !== undefined) {
        this.log.info(
          '%s: set homekit status fault from %s to %s', this.name,
          this.hk.fault, hkFault
        )
      }
      this.hk.fault = hkFault
      this.service.getCharacteristic(Characteristic.StatusFault)
        .updateValue(this.hk.fault)
    }
    if (this.config.wallSwitch && !this.config.valvePosition) {
      this.checkOn(this.obj.state.on)
    }
  }

  checkXy (xy, fromCt = false) {
    if (!this.config.xy) {
      return
    }
    if (this.obj.state.xy[0] !== xy[0] || this.obj.state.xy[1] !== xy[1]) {
      if (fromCt) {
        this.log.debug(
          '%s: %s xy predicted to change by ct from %j to %j', this.name,
          this.type, this.obj.state.xy, xy
        )
      } else if (this.obj.state.colormode === 'xy') {
        this.log.debug(
          '%s: %s xy changed from %j to %j', this.name, this.type,
          this.obj.state.xy, xy
        )
        this.disableAdaptiveLighting()
      } else {
        this.log.debug(
          '%s: %s xy changed by %s from %j to %j', this.name, this.type,
          this.obj.state.colormode, this.obj.state.xy, xy
        )
      }
      if (this.recentlyUpdated && !fromCt) {
        this.log.debug('%s: recently updated - ignore changed xy', this.name)
        return
      }
      this.obj.state.xy = xy
    }
    if (this.obj.state.colormode !== 'ct' || fromCt || this.config.computesXy) {
      const { h, s } = xyToHsv(this.obj.state.xy, this.config.gamut)
      if (this.hk.hue !== h) {
        if (this.hk.hue !== undefined) {
          this.log.info(
            '%s: set homekit hue from %s˚ to %s˚', this.name, this.hk.hue, h
          )
        }
        this.hk.hue = h
        this.service.getCharacteristic(Characteristic.Hue)
          .updateValue(this.hk.hue)
      }
      if (this.hk.sat !== s) {
        if (this.hk.sat !== undefined) {
          this.log.info(
            '%s: set homekit saturation from %s%% to %s%%', this.name,
            this.hk.sat, s
          )
        }
        this.hk.sat = s
        this.service.getCharacteristic(Characteristic.Saturation)
          .updateValue(this.hk.sat)
      }
    }
  }

  // ===== Homekit Events ========================================================

  identify (callback) {
    this.log.debug('%s: %s: config: %j', this.bridge.name, this.resource, this.config)
    this.log.info('%s: identify', this.name)
    if (!this.config.alert) {
      return callback()
    }
    let alert = 'select'
    let stop
    if (this.bridge.type === 'bridge') {
      if (this.config.noAlert) {
        return callback()
      }
    } else if (this.manufacturer === this.bridge.philips) {
      alert = 'breathe'
      stop = 'stop'
    }
    this.put({ alert }).then((obj) => {
      if (stop != null) {
        setTimeout(() => {
          this.put({ alert: stop })
        }, 1500)
      }
      return callback()
    }).catch((error) => {
      return callback(error)
    })
  }

  getOn (callback) {
    if (this.bridge.platform.config.noResponse && !this.obj.state.reachable) {
      return callback(noResponse)
    }
    return callback(null, this.hk.on)
  }

  setOn (on, callback) {
    if (on === this.hk.on) {
      return callback()
    }
    this.log.info(
      '%s: homekit on changed from %s to %s', this.name, this.hk.on, on
    )
    const oldOn = this.hk.on
    this.hk.on = on
    const newOn = this.hk.on
    const request = { on: newOn }
    this.checkAdaptiveLighting()
    this.put(request).then(() => {
      if (this.type === 'group') {
        this.obj.state[this.anyOnKey] = newOn
        this.obj.state.all_on = newOn
      } else {
        this.obj.state.on = newOn
      }
      callback()
    }).catch((error) => {
      this.hk.on = oldOn
      callback(error)
    })
  }

  setAnyOn (anyOn, callback) {
    if (anyOn === this.hk[this.anyOnKey]) {
      return callback()
    }
    this.log.info(
      '%s: homekit any on changed from %s to %s', this.name,
      this.hk[this.anyOnKey], anyOn
    )
    const oldAnyOn = this.hk[this.anyOnKey]
    this.hk[this.anyOnKey] = anyOn
    const newOn = this.hk[this.anyOnKey]
    this.put({ on: newOn }).then(() => {
      this.obj.state[this.anyOnKey] = newOn
      this.obj.state.all_on = newOn
      callback()
    }).catch((error) => {
      this.hk[this.anyOnKey] = oldAnyOn
      callback(error)
    })
  }

  setStreaming (streaming, callback) {
    if (streaming === this.hk.streaming) {
      return callback()
    }
    this.log.info(
      '%s: homekit streaming changed from %s to %s', this.name,
      this.hk.streaming, streaming
    )
    const oldStreaming = this.hk.streaming
    this.hk.streaming = streaming
    const newStreaming = this.hk.streaming
    this.bridge.put(this.resource, {
      stream: { active: newStreaming }
    }).then((obj) => {
      this.obj.state.streaming = newStreaming
      return callback()
    }).catch((error) => {
      this.hk.streaming = oldStreaming
      return callback(error)
    })
  }

  getActive (callback) {
    if (this.bridge.platform.config.noResponse && !this.obj.state.reachable) {
      return callback(noResponse)
    }
    return callback(null, this.hk.active)
  }

  setActive (active, callback) {
    if (active === this.hk.active) {
      return callback()
    }
    this.log.info(
      '%s: homekit active changed from %s to %s', this.name, this.hk.active, active
    )
    const oldActive = this.hk.active
    this.hk.active = active
    const newOn = this.hk.active === Characteristic.Active.ACTIVE
    this.put({ on: newOn }).then(() => {
      this.obj.state.on = newOn
      callback()
      this.didSetActive()
    }).catch((error) => {
      this.hk.active = oldActive
      callback(error)
    })
  }

  setBri (bri, callback) {
    // if (bri === this.hk.bri) {
    //   return callback()
    // }
    const lightConfig = this.bridge.platform.config.lightSettings.find(
        (setting) => setting.serialNumber === this.serialNumber
    );

    const originalBri = bri; // Store original brightness for logging.

    if (lightConfig && lightConfig.limit) {
      const maxBrightness = lightConfig.limit;
      bri = Math.round((bri * maxBrightness) / 100);
      this.log.info(
          '%s: Adjusting brightness from %s%% to %s%% of limit (%s%%)',
          this.name,
          originalBri,
          bri,
          maxBrightness
      );
    }

    this.log.info(
        '%s: homekit brightness changed from %s%% to %s%%',
        this.name,
        this.hk.bri,
        bri
    );
    const oldBri = this.hk.bri;
    this.hk.bri = bri;
    this.checkAdaptiveLighting();
    const newBri = Math.round(this.hk.bri * 254.0 / 100.0);
    this.put({ bri: newBri })
        .then(() => {
          this.obj.state.bri = newBri;
          callback();
        })
        .catch((error) => {
          this.hk.bri = oldBri;
          callback(error);
        });
  }

  setBriChange (delta, callback) {
    const lightConfig = this.bridge.platform.config.lightSettings.find(
        (setting) => setting.serialNumber === this.serialNumber
    );

    if (lightConfig && lightConfig.limit) {
      const maxBrightness = lightConfig.limit;
      delta = Math.round((delta * maxBrightness) / 100);
      this.log.info(
          '%s: Adjusting brightness change by %s%% of limit (%s%%)',
          this.name,
          delta,
          maxBrightness
      );
    }

    delta = Math.round(delta);
    if (delta === 0) {
      return callback();
    }

    this.log.info('%s: homekit brightness change by %s%%', this.name, delta);
    const briDelta = Math.round(delta * 254.0 / 100.0);
    this.put({ bri_inc: briDelta })
        .then(() => {
          setTimeout(() => {
            this.service.setCharacteristic(my.Characteristics.BrightnessChange, 0);
          }, this.config.resetTimeout);
          callback();
        })
        .catch((error) => {
          callback(error);
        });
  }

  setCt (ct, callback) {
    if (ct === this.hk.ct && this.obj.state.colormode === 'ct') {
      return callback()
    }
    this.log.info(
      '%s: homekit color temperature changed from %s mired to %s mired',
      this.name, this.hk.ct, ct
    )
    this.disableAdaptiveLighting()
    const oldCt = this.hk.ct
    this.hk.ct = ct
    const newCt = this.hk.ct
    this.put({ ct: newCt }).then(() => {
      this.obj.state.ct = newCt
      this.obj.state.colormode = 'ct'
      this.checkXy(ctToXy(this.obj.state.ct), true)
      callback()
    }).catch((error) => {
      this.hk.ct = oldCt
      callback(error)
    })
  }

  setDuration (duration, callback) {
    if (duration === this.hk.duration) {
      return callback()
    }
    this.log.info(
      '%s: homekit duration changed from %ss to %ss',
      this.name, this.hk.duration, duration
    )
    this.hk.duration = duration
    callback()
  }

  setHue (hue, callback) {
    if (hue === this.hk.hue && this.obj.state.colormode === 'xy') {
      return callback()
    }
    this.log.info(
      '%s: homekit hue changed from %s˚ to %s˚', this.name, this.hk.hue, hue
    )
    this.disableAdaptiveLighting()
    const oldHue = this.hk.hue
    this.hk.hue = hue
    if (this.config.xy && this.hk.sat != null) {
      const newXy = hsvToXy(this.hk.hue, this.hk.sat, this.config.gamut)
      this.put({ xy: newXy }).then(() => {
        this.obj.state.xy = newXy
        this.obj.state.colormode = 'xy'
        callback()
      }).catch((error) => {
        this.hk.hue = oldHue
        callback(error)
      })
    } else if (this.config.hs) {
      const newHue = Math.round(this.hk.hue * 65535.0 / 360.0)
      this.put({ hue: newHue }).then(() => {
        this.obj.state.hue = newHue
        this.obj.state.colormode = 'hs'
        callback()
      }).catch((error) => {
        this.hk.hue = oldHue
        callback(error)
      })
    }
  }

  setSat (sat, callback) {
    if (sat === this.hk.sat && this.obj.state.colormode === 'xy') {
      return callback()
    }
    this.log.info(
      '%s: homekit saturation changed from %s%% to %s%%', this.name,
      this.hk.sat, sat
    )
    this.disableAdaptiveLighting()
    const oldSat = this.hk.sat
    this.hk.sat = sat
    if (this.config.xy && this.hk.hue != null) {
      const newXy = hsvToXy(this.hk.hue, this.hk.sat, this.config.gamut)
      this.put({ xy: newXy }).then(() => {
        this.obj.state.xy = newXy
        this.obj.state.colormode = 'xy'
        callback()
      }).catch((error) => {
        this.hk.sat = oldSat
        callback(error)
      })
    } else if (this.config.hs) {
      const newSat = Math.round(this.hk.sat * 254.0 / 100.0)
      this.put({ sat: newSat }).then(() => {
        this.obj.state.sat = newSat
        this.obj.state.colormode = 'hs'
        callback()
      }).catch((error) => {
        this.hk.sat = oldSat
        callback(error)
      })
    }
  }

  setColorLoop (colorLoop, callback) {
    if (colorLoop === this.hk.colorLoop) {
      return callback()
    }
    this.log.info(
      '%s: homekit color loop changed from %s to %s', this.name,
      this.hk.colorLoop, colorLoop
    )
    this.disableAdaptiveLighting()
    const oldColorLoop = this.hk.colorLoop
    this.hk.colorLoop = colorLoop
    const state = { effect: this.hk.colorLoop ? 'colorloop' : 'none' }
    this.put(state).then(() => {
      this.obj.state.effect = state.effect
      callback()
    }).catch((error) => {
      this.hk.colorLoop = oldColorLoop
      callback(error)
    })
  }

  getRemainingDuration (callback) {
    let remaining = this.hk.autoInActive - new Date().valueOf()
    remaining = remaining > 0 ? Math.round(remaining / 1000) : 0
    this.log.info('%s: remaining duration %ss', this.name, remaining)
    callback(null, remaining)
  }

  didSetActive () {
    if (this.hk.duration > 0) {
      if (this.hk.active) {
        this.hk.autoInActive = new Date().valueOf() + this.hk.duration * 1000
        this.hk.autoInActiveTimeout = setTimeout(() => {
          this.log.debug('%s: remaining duration 0s', this.name)
          this.put({ on: false }).then(() => {
          }).catch((error) => {
            this.log.warn('%s: error %s', this.name, formatError(error))
          })
        }, this.hk.duration * 1000)
      } else {
        if (this.hk.autoInActiveTimeout != null) {
          clearTimeout(this.hk.autoInActiveTimeout)
          delete this.hk.autoInActiveTimeout
        }
      }
    }
    setTimeout(() => {
      this.log.info('%s: set homekit in use to %s', this.name, this.hk.active)
      this.service.updateCharacteristic(Characteristic.InUse, this.hk.active)
      if (this.hk.active && this.hk.duration > 0) {
        this.log.info(
          '%s: set homekit remaining duration to %ss', this.name, this.hk.duration
        )
        this.service.updateCharacteristic(
          Characteristic.RemainingDuration, this.hk.duration
        )
      } else if (this.hk.autoInActive !== 0) {
        this.hk.autoInActive = 0
        this.log.info('%s: set homekit remaining duration to 0s', this.name)
        this.service.updateCharacteristic(Characteristic.RemainingDuration, 0)
      }
    }, 500)
  }

  getSupportedTransitionConfiguration (callback) {
    try {
      // The SuppotedTransitionConfiguration value is constant, but the iid values
      // for the characteristics are only assigned when the HAP server is started,
      // so we cannot set the value while defining the service.
      const bri = this.service.getCharacteristic(Characteristic.Brightness).iid
      const ct = this.service.getCharacteristic(Characteristic.ColorTemperature).iid
      this.log.debug(
        '%s: brightness idd: %d, color temperature idd: %d', this.name, bri, ct
      )
      this.al = new AdaptiveLighting(bri, ct)
      const configuration = this.al.generateConfiguration()
      this.log.debug(
        '%s: set homekit supported transition configuration to %s', this.name,
        configuration
      )
      this.log.info(
        '%s: set homekit supported transition configuration to %j', this.name,
        this.al.parseConfiguration(configuration)
      )
      // Remove the event handler, since we now have the value.
      this.service.getCharacteristic(Characteristic.SupportedCharacteristicValueTransitionConfiguration)
        .setValue(configuration)
        .removeAllListeners('get')
      callback(null, configuration)
    } catch (error) {
      this.log.warn(
        '%s: cannot compute supported transition configuration: %s', this.name,
        formatError(error)
      )
      callback(error)
    }
  }

  getTransitionControl (callback) {
    try {
      if (this.al == null) {
        return callback(null, '')
      }
      const control = this.al.generateControl()
      this.log.debug(
        '%s: set homekit transition control to %j', this.name, control
      )
      if (control !== '') {
        this.log.info(
          '%s: set homekit transition control to %j', this.name,
          this.al.parseControl(control)
        )
      }
      callback(null, control)
    } catch (error) {
      this.log.warn(
        '%s: cannot compute transition control: %s', this.name,
        formatError(error)
      )
      callback(error)
    }
  }

  setTransitionControl (control, callback) {
    try {
      this.log.debug(
        '%s: homekit transition control set to %j', this.name, control
      )
      this.log.info(
        '%s: homekit transition control set to %j', this.name,
        this.al.parseControl(control)
      )
      const controlResponse = this.al.generateControlResponse()
      this.log.debug(
        '%s: set homekit transition control to %j', this.name, controlResponse
      )
      this.log.info(
        '%s: set homekit transition control to %j', this.name,
        this.al.parseControl(controlResponse)
      )
      this.log.info('%s: set homekit active transition count to 1', this.name)
      this.service.getCharacteristic(
        Characteristic.CharacteristicValueActiveTransitionCount
      )
        .updateValue(1)
      this.checkAdaptiveLighting()
      callback(null, controlResponse)
    } catch (error) {
      this.log.warn(
        '%s: cannot handle transition control: %s', this.name,
        formatError(error)
      )
    }
  }

  checkAdaptiveLighting () {
    if (this.al == null || !this.hk.on) {
      return
    }
    const ct = this.al.getCt(
      this.hk.bri * this.bridge.platform.config.brightnessAdjustment
    )
    if (ct == null) {
      return
    }
    if (ct !== this.hk.ct || this.obj.state.colormode !== 'ct') {
      this.log.info(
        '%s: homekit adaptive lighting color temperature changed from %s mired to %s mired',
        this.name, this.hk.ct, ct
      )
      const oldCt = this.hk.ct
      this.hk.ct = ct
      const newCt = this.hk.ct
      this.put({ ct: newCt }).then(() => {
        this.obj.state.ct = newCt
        this.obj.state.colormode = 'ct'
        this.checkXy(ctToXy(this.obj.state.ct), true)
      }).catch(() => {
        this.hk.ct = oldCt
      })
    }
  }

  disableAdaptiveLighting () {
    if (this.al != null && this.al.active && !this.recentlyUpdated) {
      this.al.deactivate()
      this.log.info('%s: set homekit active transition count to 0', this.name)
      this.service.getCharacteristic(
        Characteristic.CharacteristicValueActiveTransitionCount
      )
        .updateValue(0)
    }
  }

  // Collect changes into a combined request.
  put (state) {
    return new Promise((resolve, reject) => {
      for (const key in state) {
        this.desiredState[key] = state[key]
      }
      const d = { resolve, reject }
      this.deferrals.push(d)
      if (this.updating) {
        return
      }
      this.updating = true
      if (this.config.waitTimeUpdate > 0) {
        setTimeout(() => {
          this._put()
        }, this.config.waitTimeUpdate)
      } else {
        this._put()
      }
    })
  }

  // Send the request (for the combined changes) to the Hue bridge.
  _put () {
    const desiredState = this.desiredState
    const deferrals = this.deferrals
    this.desiredState = {}
    this.deferrals = []
    this.updating = false
    if (
      this.bridge.state.transitiontime !== this.bridge.defaultTransitiontime &&
      desiredState.transitiontime === undefined
    ) {
      desiredState.transitiontime = this.bridge.state.transitiontime * 10
      this.bridge.resetTransitionTime()
    }
    if (this.config.noTransition) {
      if (
        (
          desiredState.on != null || desiredState.bri != null ||
          desiredState.bri_inc != null
        ) && (
          desiredState.xy != null || desiredState.ct != null ||
          desiredState.hue != null || desiredState.sat != null ||
          desiredState.effect != null
        )
      ) {
        desiredState.transitiontime = 0
      }
    }
    this.bridge.put(this.resourcePath, desiredState).then((obj) => {
      if (this.bridge.platform.config.noResponse && !this.obj.state.reachable) {
        this.log.warn('%s: %s not reachable', this.name, this.resource)
        for (const d of deferrals) {
          d.reject(noResponse)
        }
        return
      }
      this.recentlyUpdated = true
      for (const d of deferrals) {
        d.resolve(true)
      }
      setTimeout(() => {
        this.recentlyUpdated = false
      }, 500)
    }).catch((error) => {
      for (const d of deferrals) {
        d.reject(error)
      }
    })
  }
}

export { HueLight }
