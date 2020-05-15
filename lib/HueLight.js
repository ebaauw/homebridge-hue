// homebridge-hue/lib/HueLight.js
// Copyright © 2016-2020 Erik Baauw. All rights reserved.
//
// Homebridge plugin for Philips Hue and/or deCONZ.
//
// HueLight provides support for Philips Hue lights and groups.

'use strict'

const moment = require('moment')
const homebridgeLib = require('homebridge-lib')

module.exports = {
  setHomebridge: setHomebridge,
  HueLight: HueLight
}

const formatError = homebridgeLib.CommandLineTool.formatError

// Safe default gamut taking into account:
// - The maximum value for CurrentX and  CurrentY, 65279 (0xfeff), as defined
//   by the ZCL spec;
// - A potential division by zero error for CurrentY, when translating the
//   xy values back to hue/sat.
const defaultGamut = {
  r: [0.9961, 0.0001],
  g: [0, 0.9961],
  b: [0, 0.0001]
}

const knownLights = {
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
      'GL-C-008': { noWaitUpdate: true },
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
            '%s: %s: set model to %s', this.bridge.name,
            this.resource, this.model
          )
        }
      }
    }
  },
  'IKEA of Sweden': {
    // See: http://www.ikea.com/us/en/catalog/categories/departments/lighting/smart_lighting/
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
  MLI: { // Issue #439
    gamut: {
      r: [0.68, 0.31],
      g: [0.11, 0.82],
      b: [0.13, 0.04]
    }
  },
  'Neuhaus Lighting Group ': { // Issue #455
  },
  OSRAM: {
    gamut: {
      r: [0.6877, 0.3161],
      g: [0.1807, 0.7282],
      b: [0.1246, 0.0580]
    },
    fix: function () {
      if (this.obj.swversion === 'V1.03.07') {
        this.config.noTransitionTime = true
      }
    }
  },
  Pee: { // Issue #217
  },
  Philips: {
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
  ShenZhen_Homa: { // PR #234, issue #235
  }
}

knownLights['Signify Netherlands B.V'] = knownLights.Philips

// ===== Colour Conversion =====================================================

// Return point in color gamut closest to p.
function closestInGamut (p, gamut) {
  // Return cross product of two points.
  function crossProduct (p1, p2) {
    return p1.x * p2.y - p1.y * p2.x
  }

  // Return distance between two points.
  function distance (p1, p2) {
    const dx = p1.x - p2.x
    const dy = p1.y - p2.y
    return Math.sqrt(dx * dx + dy * dy)
  }

  // Return point on line a,b closest to p.
  function closest (a, b, p) {
    const ap = { x: p.x - a.x, y: p.y - a.y }
    const ab = { x: b.x - a.x, y: b.y - a.y }
    let t = (ap.x * ab.x + ap.y * ab.y) / (ab.x * ab.x + ab.y * ab.y)
    t = t < 0.0 ? 0.0 : t > 1.0 ? 1.0 : t
    return { x: a.x + t * ab.x, y: a.y + t * ab.y }
  }

  const R = { x: gamut.r[0], y: gamut.r[1] }
  const G = { x: gamut.g[0], y: gamut.g[1] }
  const B = { x: gamut.b[0], y: gamut.b[1] }
  const v1 = { x: G.x - R.x, y: G.y - R.y }
  const v2 = { x: B.x - R.x, y: B.y - R.y }
  const v = crossProduct(v1, v2)
  const q = { x: p.x - R.x, y: p.y - R.y }
  const s = crossProduct(q, v2) / v
  const t = crossProduct(v1, q) / v
  if (s >= 0.0 && t >= 0.0 && s + t <= 1.0) {
    return p
  }
  const pRG = closest(R, G, p)
  const pGB = closest(G, B, p)
  const pBR = closest(B, R, p)
  const dRG = distance(p, pRG)
  const dGB = distance(p, pGB)
  const dBR = distance(p, pBR)
  let min = dRG
  p = pRG
  if (dGB < min) {
    min = dGB
    p = pGB
  }
  if (dBR < min) {
    p = pBR
  }
  return p
}

// Transform bridge xy values [0.0000, 1.0000]
// to homekit hue value [0˚, 360˚] and saturation value [0%, 100%].
function hueSat (xy, gamut) {
  // Inverse Gamma correction (sRGB Companding).
  function compand (v) {
    return v <= 0.0031308
      ? 12.92 * v : (1.0 + 0.055) * Math.pow(v, (1.0 / 2.4)) - 0.055
  }

  // Correction for negative values is missing from Philips' documentation.
  function correctNegative () {
    const m = Math.min(R, G, B)
    if (m < 0.0) {
      R -= m
      G -= m
      B -= m
    }
  }

  function rescale () {
    const M = Math.max(R, G, B)
    if (M > 1.0) {
      R /= M
      G /= M
      B /= M
    }
  }

  // xyY to XYZ to RGB
  // See: https://developers.meethue.com/develop/application-design-guidance/color-conversion-formulas-rgb-to-xy-and-back/
  const p = closestInGamut({ x: xy[0], y: xy[1] }, gamut)
  const x = p.x
  const y = p.y === 0.0 ? 0.000001 : p.y
  const z = 1.0 - x - y
  const Y = 1.0
  const X = (Y / y) * x
  const Z = (Y / y) * z
  let R = X * 1.656492 + Y * -0.354851 + Z * -0.255038
  let G = X * -0.707196 + Y * 1.655397 + Z * 0.036152
  let B = X * 0.051713 + Y * -0.121364 + Z * 1.011530
  correctNegative()
  rescale()
  R = compand(R)
  G = compand(G)
  B = compand(B)
  rescale()

  // RGB to HSV
  // See: https://en.wikipedia.org/wiki/HSL_and_HSV
  const M = Math.max(R, G, B)
  const m = Math.min(R, G, B)
  const C = M - m
  const S = (M === 0.0) ? 0.0 : C / M
  let H
  switch (M) {
    case m:
      H = 0.0
      break
    case R:
      H = (G - B) / C
      if (H < 0) {
        H += 6.0
      }
      break
    case G:
      H = (B - R) / C
      H += 2.0
      break
    case B:
      H = (R - G) / C
      H += 4.0
      break
  }
  return { hue: Math.round(H * 60.0), sat: Math.round(S * 100.0) }
}

// Transform homekit hue value [0˚, 360˚] and saturation value [0%, 100%]
// to bridge xy values [0.0, 1.0].
function invHueSat (hue, sat, gamut) {
  // Gamma correction (inverse sRGB Companding).
  function invCompand (v) {
    return v > 0.04045 ? Math.pow((v + 0.055) / (1.0 + 0.055), 2.4) : v / 12.92
  }

  // HSV to RGB
  // See: https://en.wikipedia.org/wiki/HSL_and_HSV
  let H = hue / 360.0
  const S = sat / 100.0
  const V = 1
  const C = V * S
  H *= 6
  const m = V - C
  let x = (H % 2) - 1.0
  if (x < 0) {
    x = -x
  }
  x = C * (1.0 - x)
  let R, G, B
  switch (Math.floor(H) % 6) {
    case 0: R = C + m; G = x + m; B = m; break
    case 1: R = x + m; G = C + m; B = m; break
    case 2: R = m; G = C + m; B = x + m; break
    case 3: R = m; G = x + m; B = C + m; break
    case 4: R = x + m; G = m; B = C + m; break
    case 5: R = C + m; G = m; B = x + m; break
  }

  // RGB to XYZ to xyY
  // See: http://www.developers.meethue.com/documentation/color-conversions-rgb-xy
  const linearR = invCompand(R)
  const linearG = invCompand(G)
  const linearB = invCompand(B)
  const X = linearR * 0.664511 + linearG * 0.154324 + linearB * 0.162028
  const Y = linearR * 0.283881 + linearG * 0.668433 + linearB * 0.047685
  const Z = linearR * 0.000088 + linearG * 0.072310 + linearB * 0.986039
  const sum = X + Y + Z
  const p = sum === 0.0 ? { x: 0.0, y: 0.0 } : { x: X / sum, y: Y / sum }
  const q = closestInGamut(p, gamut)
  return [Math.round(q.x * 10000) / 10000, Math.round(q.y * 10000) / 10000]
}

// ===== Homebridge ============================================================

let Service
let Characteristic
let my
let eve

function setHomebridge (homebridge, _my, _eve) {
  Service = homebridge.hap.Service
  Characteristic = homebridge.hap.Characteristic
  my = _my
  eve = _eve
}

// ===== HueLight ==============================================================

function HueLight (accessory, id, obj, type = 'light') {
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
  if (this.config.windowCovering) {
    this.service = new Service.WindowCovering(this.name, this.subtype)
    this.service.getCharacteristic(Characteristic.TargetPosition)
      .on('set', this.setPosition.bind(this))
      .setProps({ minStep: 5 })
    this.checkPosition(this.obj.state.bri)
    this.service.getCharacteristic(Characteristic.HoldPosition)
      .on('set', this.setHoldPosition.bind(this))
      .setValue(false)
    if (this.config.sat) {
      this.service.getCharacteristic(Characteristic.TargetHorizontalTiltAngle)
        .on('set', this.setTilt.bind(this))
        .setProps({ minStep: 5 })
      this.checkTilt(this.obj.state.sat)
    }
  } else if (!this.config.on) { // Warning device
    this.service = new Service.Outlet(this.name, this.subtype)
    this.service.getCharacteristic(Characteristic.OutletInUse)
      .updateValue(1)
    this.service.getCharacteristic(Characteristic.On)
      .on('set', this.setWarning.bind(this))
    this.checkOn(this.obj.state.on)
    this.hk.duration = 0
    this.service.addOptionalCharacteristic(Characteristic.SetDuration)
    this.service.getCharacteristic(Characteristic.SetDuration)
      .updateValue(this.hk.duration)
      .on('set', this.setDuration.bind(this))
    this.hk.mute = 0
    this.service.addOptionalCharacteristic(Characteristic.Mute)
    this.service.getCharacteristic(Characteristic.Mute)
      .updateValue(this.hk.mute)
      .on('set', this.setMute.bind(this))
  } else {
    if (this.config.outlet) {
      this.service = new Service.Outlet(this.name, this.subtype)
      this.service.getCharacteristic(Characteristic.OutletInUse)
        .updateValue(1)
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
        .on('set', this.setActive.bind(this))
      this.checkActive(this.obj.state.on)
      this.hk.duration = 0
      this.service.getCharacteristic(Characteristic.SetDuration)
        .updateValue(this.hk.duration)
        .on('set', this.setDuration.bind(this))
      this.hk.autoInActive = 0
      this.service.getCharacteristic(Characteristic.RemainingDuration)
        .updateValue(0)
        .on('get', this.getRemainingDuration.bind(this))
    } else {
      this.service.getCharacteristic(Characteristic.On)
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
      this.colorTemperatureCharacteristic = this.config.xy
        ? eve.Characteristics.ColorTemperature
        : Characteristic.ColorTemperature
      this.service.addOptionalCharacteristic(this.colorTemperatureCharacteristic)
      this.service.getCharacteristic(this.colorTemperatureCharacteristic)
        .on('set', this.setCT.bind(this))
        .setProps({
          minValue: this.config.minCT,
          maxValue: this.config.maxCT
        })
      this.checkCT(this.obj.state.ct)
    }
    if (this.config.xy || this.config.hs) {
      this.service.getCharacteristic(Characteristic.Hue)
        .on('set', this.setHue.bind(this))
      this.service.getCharacteristic(Characteristic.Saturation)
        .on('set', this.setSat.bind(this))
      if (this.config.xy) {
        this.checkXY(this.obj.state.xy)
      } else {
        this.checkHue(this.obj.state.hue)
        this.checkSat(this.obj.state.sat)
      }
    }
    if (this.config.colorloop) {
      this.service.addOptionalCharacteristic(my.Characteristics.ColorLoop)
      this.service.getCharacteristic(my.Characteristics.ColorLoop)
        .on('set', this.setColorLoop.bind(this))
    }
  }
  if (this.type === 'light') {
    this.service.addOptionalCharacteristic(Characteristic.StatusFault)
    this.checkReachable(this.obj.state.reachable)
    if (this.bridge.config.nativeHomeKitLights) {
      this.service.addOptionalCharacteristic(my.Characteristics.UniqueID)
      this.service.getCharacteristic(my.Characteristics.UniqueID)
        .updateValue(this.obj.uniqueid)
    }
  }
  if (this.bridge.platform.config.resource) {
    this.service.addOptionalCharacteristic(my.Characteristics.Resource)
    this.service.getCharacteristic(my.Characteristics.Resource)
      .updateValue(this.resource)
  }
}

// Store configuration to this.config.
HueLight.prototype.setConfig = function () {
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
    colorloop: this.obj.state.effect !== undefined,
    wallSwitch: false,
    outlet: this.bridge.outlet[this.type + 's'][this.id],
    resetTimeout: this.bridge.platform.config.resetTimeout,
    valve: this.type === 'light' && this.bridge.valve[this.id],
    waitTimeUpdate: this.bridge.platform.config.waitTimeUpdate
  }
  if (this.config.outlet || this.config.valve) {
    this.config.bri = false
    this.config.ct = false
    this.config.xy = false
    this.config.windowCovering = false
  } else if (this.obj.type === 'Window covering device') {
    this.config.windowCovering = true
    this.config.sat = this.obj.state.sat !== undefined
    this.config.ct = false
    this.config.xy = false
  } else if (this.type === 'light') {
    this.config.wallSwitch = this.bridge.platform.config.wallSwitch ||
      this.bridge.wallswitch[this.id]
  }
  if (this.config.ct) {
    // Default colour temperature range: 153 (~6500K) - 500 (2000K).
    this.config.minCT = 153
    this.config.maxCT = 500
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
    if (model.minCT != null) {
      // whitelisted model
      this.config.minCT = model.minCT
    } else if (manufacturer.minCT != null) {
      // whitelisted manufacturer default
      this.config.minCT = manufacturer.minCT
    } else if (this.obj.ctmin != null && this.obj.ctmin !== 0) {
      // reported by deCONZ
      this.config.minCT = this.obj.ctmin
    } else if (
      this.obj.capabilities != null && this.obj.capabilities.control != null &&
      this.obj.capabilities.control.ct != null &&
      this.obj.capabilities.control.ct.min !== 0
    ) {
      // reported by Hue bridge
      this.config.minCT = this.obj.capabilities.control.ct.min
    }
    if (model.maxCT != null) {
      // whitelisted model
      this.config.maxCT = model.maxCT
    } else if (manufacturer.maxCT != null) {
      // whitelisted manufacturer default
      this.config.maxCT = manufacturer.maxCT
    } else if (
      this.obj.ctmax != null &&
      this.obj.ctmax !== 0 && this.obj.ctmax !== 65535
    ) {
      // reported by deCONZ
      this.config.maxCT = this.obj.ctmax
    } else if (
      this.obj.capabilities != null && this.obj.capabilities.control != null &&
      this.obj.capabilities.control.ct != null &&
      this.obj.capabilities.control.ct.max !== 0 &&
      this.obj.capabilities.control.ct.max !== 65535
    ) {
      // reported by Hue bridge
      this.config.maxCT = this.obj.capabilities.control.ct.max
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
  }
  if (model.noAlert) {
    this.config.noAlert = true
  }
  if (model.noWallSwitch) {
    this.config.wallSwitch = false
  }
  if (model.noWaitUpdate) {
    this.config.waitTimeUpdate = 0
  }
  this.log.debug('%s: %s: config: %j', this.bridge.name, this.resource, this.config)
}

// ===== Bridge Events =========================================================

HueLight.prototype.heartbeat = function (beat, obj) {
  if (this.updating) {
    return
  }
  for (const key in obj.action) {
    if (key !== 'on') {
      obj.state[key] = obj.action[key]
    }
  }
  this.checkState(obj.state)
  if (this.config.streaming) {
    this.checkStreaming(obj.stream.active)
  }
}

HueLight.prototype.checkState = function (state, event) {
  for (const key in state) {
    switch (key) {
      case 'alert':
        break
      // jshint -W106
      case 'all_on':
        this.checkAllOn(state.all_on)
        break
      case 'any_on':
        this.checkAnyOn(state.any_on)
        break
      // jshint +W106
      case 'bri':
        if (this.config.windowCovering) {
          this.checkPosition(state.bri)
          break
        }
        this.checkBri(state.bri)
        break
      case 'colormode':
        this.obj.state.colormode = state.colormode
        break
      case 'ct':
        this.checkCT(state.ct)
        break
      case 'effect':
        this.checkEffect(state.effect)
        break
      case 'hue':
        this.checkHue(state.hue)
        break
      case 'mode':
        break
      case 'lift':
        break
      case 'on':
        if (this.config.valve) {
          this.checkActive(state.on)
        } else {
          this.checkOn(state.on)
        }
        break
      case 'open':
        break
      case 'reachable':
        this.checkReachable(state.reachable)
        break
      case 'sat':
        if (this.config.windowCovering) {
          this.checkTilt(state.sat)
          break
        }
        this.checkSat(state.sat)
        break
      case 'scene':
        break
      case 'tilt':
        break
      case 'x':
        break
      case 'xy':
        this.checkXY(state.xy)
        break
      case 'y':
        break
      default:
        this.log.debug(
          '%s: ignore unknown attribute state.%s', this.name, key
        )
        break
    }
  }
}

HueLight.prototype.checkOn = function (on) {
  if (this.config.windowCovering) {
    // handle state.bri only as state.on is derived from state.bri
    return
  }
  if (this.obj.state.on !== on) {
    this.log.debug(
      '%s: %s on changed from %s to %s', this.name, this.type,
      this.obj.state.on, on
    )
    this.obj.state.on = on
  }
  let hkOn
  if (this.config.wallSwitch && this.obj.state.reachable !== true) {
    if (this.hk.on) {
      this.log.info('%s: not reachable: force homekit on to 0', this.name)
    }
    hkOn = 0
  } else {
    hkOn = this.obj.state.on ? 1 : 0
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
  }
}

HueLight.prototype.checkAllOn = function (allOn) {
  // jshint -W106
  if (this.obj.state.all_on !== allOn) {
    this.log.debug(
      '%s: %s all_on changed from %s to %s', this.name, this.type,
      this.obj.state.all_on, allOn
    )
    this.obj.state.all_on = allOn
  }
  const hkOn = this.obj.state.all_on ? 1 : 0
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

HueLight.prototype.checkAnyOn = function (anyOn) {
  // jshint -W106
  if (this.obj.state[this.anyOnKey] !== anyOn) {
    this.log.debug(
      '%s: %s any_on changed from %s to %s', this.name, this.type,
      this.obj.state[this.anyOnKey], anyOn
    )
    this.obj.state[this.anyOnKey] = anyOn
  }
  const hkAnyOn = this.obj.state[this.anyOnKey] ? 1 : 0
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

HueLight.prototype.checkStreaming = function (streaming) {
  if (this.obj.state.streaming !== streaming) {
    this.log.debug(
      '%s: streaming changed from %s to %s', this.name,
      this.obj.state.streaming, streaming
    )
    this.obj.state.streaming = streaming
  }
  const hkStreaming = this.obj.state.streaming ? 1 : 0
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

HueLight.prototype.checkActive = function (on) {
  if (this.obj.state.on !== on) {
    this.log.debug(
      '%s: %s active changed from %s to %s', this.name, this.type,
      this.obj.state.on, on
    )
    this.obj.state.on = on
  }
  const hkActive = this.obj.state.on ? 1 : 0
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

HueLight.prototype.checkBri = function (bri) {
  if (!this.config.bri) {
    return
  }
  if (this.obj.state.bri !== bri) {
    this.log.debug(
      '%s: %s bri changed from %s to %s', this.name, this.type,
      this.obj.state.bri, bri
    )
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
  }
}

HueLight.prototype.checkCT = function (ct) {
  if (!this.config.ct) {
    return
  }
  if (this.obj.state.ct !== ct) {
    if (this.obj.state.colormode === 'ct') {
      this.log.debug(
        '%s: %s ct changed from %s to %s', this.name, this.type,
        this.obj.state.ct, ct
      )
    } else {
      this.log.debug(
        '%s: %s ct updated by %s from %s to %s', this.name, this.type,
        this.obj.state.colormode, this.obj.state.ct, ct
      )
    }
    if (this.recentlyUpdated) {
      this.log.debug('%s: recently updated - ignore changed ct', this.name)
      return
    }
    this.obj.state.ct = ct
  }
  const hkCT = Math.max(this.config.minCT, Math.min(this.config.maxCT, ct))
  if (this.hk.ct !== hkCT) {
    if (this.hk.ct !== undefined) {
      this.log.info(
        '%s: set homekit color temperature from %s mired to %s mired',
        this.name, this.hk.ct, hkCT
      )
    }
    this.hk.ct = hkCT
    this.service.getCharacteristic(this.colorTemperatureCharacteristic)
      .updateValue(this.hk.ct)
  }
}

HueLight.prototype.checkHue = function (hue) {
  if (!this.config.hs) {
    return
  }
  if (this.obj.state.hue !== hue) {
    if (this.obj.state.colormode === 'hs') {
      this.log.debug(
        '%s: %s hue changed from %s to %s', this.name, this.type,
        this.obj.state.hue, hue
      )
    } else {
      this.log.debug(
        '%s: %s hue changed by %s from %s to %s', this.name, this.type,
        this.obj.state.colormode, this.obj.state.hue, hue
      )
    }
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

HueLight.prototype.checkSat = function (sat) {
  if (!this.config.hs) {
    return
  }
  if (this.obj.state.sat !== sat) {
    if (this.obj.state.colormode === 'hs') {
      this.log.debug(
        '%s: %s sat changed from %s to %s', this.name, this.type,
        this.obj.state.sat, sat
      )
    } else {
      this.log.debug(
        '%s: %s sat changed by %s from %s to %s', this.name, this.type,
        this.obj.state.colormode, this.obj.state.sat, sat
      )
    }
    this.obj.state.sat = sat
  }
  const hkSat = Math.round(this.obj.state.sat * 100.0 / 254.0)
  if (this.hk.sat !== hkSat) {
    if (this.hk.sat !== undefined) {
      this.log.info(
        '%s: set homekit sat from %s%%to %s%%', this.name,
        this.hk.sat, hkSat
      )
    }
    this.hk.sat = hkSat
    this.service.getCharacteristic(Characteristic.Saturation)
      .updateValue(this.hk.sat)
  }
}

HueLight.prototype.checkEffect = function (effect) {
  if (!this.config.colorloop) {
    return
  }
  if (this.obj.state.effect !== effect) {
    this.log.debug(
      '%s: %s effect changed from %s to %s', this.name, this.type,
      this.obj.state.effect, effect
    )
    this.obj.state.effect = effect
  }
  const hkColorloop = effect === 'colorloop'
  if (this.hk.colorloop !== hkColorloop) {
    if (this.hk.colorloop !== undefined) {
      this.log.info(
        '%s: set homekit colorloop from %s to %s', this.name,
        this.hk.colorloop, hkColorloop
      )
    }
    this.hk.colorloop = hkColorloop
    this.service.getCharacteristic(my.Characteristics.ColorLoop)
      .updateValue(this.hk.colorloop)
  }
}

HueLight.prototype.checkReachable = function (reachable) {
  if (this.obj.state.reachable !== reachable) {
    this.log.debug(
      '%s: %s reachable changed from %s to %s', this.name, this.type,
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
    if (this.config.wallSwitch && !this.config.valve) {
      this.checkOn(this.obj.state.on)
    }
  }
}

HueLight.prototype.checkXY = function (xy) {
  if (!this.config.xy) {
    return
  }
  if (this.obj.state.xy[0] !== xy[0] || this.obj.state.xy[1] !== xy[1]) {
    if (this.obj.state.colormode === 'xy') {
      this.log.debug(
        '%s: %s xy changed from %j to %j', this.name, this.type,
        this.obj.state.xy, xy
      )
    } else {
      this.log.debug(
        '%s: %s xy changed by %s from %j to %j', this.name, this.type,
        this.obj.state.colormode, this.obj.state.xy, xy
      )
    }
    if (this.recentlyUpdated) {
      this.log.debug('%s: recently updated - ignore changed xy', this.name)
      return
    }
    this.obj.state.xy = xy
  }
  const hs = hueSat(this.obj.state.xy, this.config.gamut)
  const hkHue = hs.hue
  const hkSat = hs.sat
  if (this.hk.hue !== hkHue) {
    if (this.hk.hue !== undefined) {
      this.log.info(
        '%s: set homekit hue from %s˚ to %s˚', this.name, this.hk.hue, hkHue
      )
    }
    this.hk.hue = hkHue
    this.service.getCharacteristic(Characteristic.Hue)
      .updateValue(this.hk.hue)
  }
  if (this.hk.sat !== hkSat) {
    if (this.hk.sat !== undefined) {
      this.log.info(
        '%s: set homekit saturation from %s%% to %s%%', this.name,
        this.hk.sat, hkSat
      )
    }
    this.hk.sat = hkSat
    this.service.getCharacteristic(Characteristic.Saturation)
      .updateValue(this.hk.sat)
  }
}

HueLight.prototype.checkPosition = function (bri) {
  if (!this.config.windowCovering || !this.config.bri) {
    return
  }
  if (this.obj.state.bri !== bri) {
    this.log.debug(
      '%s: %s bri (position) changed from %s to %s', this.name, this.type,
      this.obj.state.bri, bri
    )
    this.obj.state.bri = bri
  }
  let hkPosition = 100 - Math.round(this.obj.state.bri * 100.0 / 254.0)
  hkPosition = 5 * Math.round(hkPosition / 5.0) // round to multiple of 5
  if (this.hk.currentPosition !== hkPosition) {
    if (this.hk.currentPosition !== undefined) {
      this.log.info(
        '%s: set homekit current position from %s%% to %s%%', this.name,
        this.hk.currentPosition, hkPosition
      )
    }
    this.hk.currentPosition = hkPosition
    this.service.getCharacteristic(Characteristic.CurrentPosition)
      .updateValue(this.hk.currentPosition)
    this.service.getCharacteristic(Characteristic.PositionState)
      .updateValue(Characteristic.PositionState.STOPPED)
    this.hk.targetPosition = hkPosition
    this.service.getCharacteristic(Characteristic.TargetPosition)
      .updateValue(this.hk.targetPosition)
  }
}

HueLight.prototype.checkTilt = function (sat) {
  if (!this.config.windowCovering || !this.config.sat) {
    return
  }
  if (this.obj.state.sat !== sat) {
    this.log.debug(
      '%s: %s sat (tilt) changed from %s to %s', this.name, this.type,
      this.obj.state.sat, sat
    )
    this.obj.state.sat = sat
  }
  let hkTilt = Math.round(this.obj.state.sat * 180.0 / 254.0) - 90
  hkTilt = 5 * Math.round(hkTilt / 5.0) // round to multiple of 5
  if (this.hk.currentTilt !== hkTilt) {
    if (this.hk.currentTilt !== undefined) {
      this.log.info(
        '%s: set homekit current tilt from %s%% to %s%%', this.name,
        this.hk.currentTilt, hkTilt
      )
    }
    this.hk.currentTilt = hkTilt
    this.service.getCharacteristic(Characteristic.CurrentHorizontalTiltAngle)
      .updateValue(this.hk.currentTilt)
    this.hk.targetTilt = hkTilt
    this.service.getCharacteristic(Characteristic.TargetHorizontalTiltAngle)
      .updateValue(this.hk.targetTilt)
  }
}

// ===== Homekit Events ========================================================

HueLight.prototype.identify = function (callback) {
  this.log.debug('%s: %s: config: %j', this.bridge.name, this.resource, this.config)
  this.log.info('%s: identify', this.name)
  if (this.config.valve) {
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
  } else if (!this.config.on) {
    alert = 'blink'
    stop = 'none'
  }
  this.put({ alert: alert }).then((obj) => {
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

HueLight.prototype.setWarning = function (on, callback) {
  on = on ? 1 : 0
  if (on === this.hk.on) {
    return callback()
  }
  this.log.info(
    '%s: homekit on changed from %s to %s', this.name, this.hk.on, on
  )
  const onTime = this.hk.duration > 0 ? this.hk.duration : 1
  let body = { alert: 'none' }
  if (on) {
    if (this.hk.mute) {
      body = { alert: 'blink', ontime: onTime }
    } else if (this.hk.duration === 0) {
      body = { alert: 'select' }
    } else {
      body = { alert: 'lselect', ontime: onTime }
    }
  }
  this.put(body).then((obj) => {
    setTimeout(() => {
      if (this.hk.on === 1) {
        this.log.info('%s: set homekit on from 1 to 0', this.name)
        this.hk.on = 0
        this.service.updateCharacteristic(Characteristic.On, this.hk.on)
      }
    }, onTime * 1000)
    this.hk.on = on
    return callback()
  }).catch((error) => {
    return callback(error)
  })
}

HueLight.prototype.setMute = function (mute, callback) {
  mute = mute ? 1 : 0
  if (mute === this.hk.mute) {
    return callback()
  }
  this.log.info(
    '%s: homekit mute changed from %s to %s', this.name, this.hk.mute, mute
  )
  this.hk.mute = mute
  return callback()
}

HueLight.prototype.setOn = function (on, callback) {
  on = on ? 1 : 0
  if (on && this.config.wallSwitch && this.obj.state.reachable !== true) {
    return callback(new Error('unreachable'))
  }
  if (on === this.hk.on) {
    return callback()
  }
  this.log.info(
    '%s: homekit on changed from %s to %s', this.name, this.hk.on, on
  )
  const oldOn = this.hk.on
  this.hk.on = on
  const newOn = !!this.hk.on
  const request = { on: newOn }
  if (this.config.noTransitionTime && !newOn) {
    request.transitiontime = 0
  }
  this.put(request).then(() => {
    if (this.type === 'group') {
      // jshint -W106
      this.obj.state[this.anyOnKey] = newOn
      this.obj.state.all_on = newOn
      // jshint +W106
    } else {
      this.obj.state.on = newOn
    }
    callback()
  }).catch((error) => {
    this.hk.on = oldOn
    callback(error)
  })
}

HueLight.prototype.setAnyOn = function (anyOn, callback) {
  anyOn = anyOn ? 1 : 0
  if (anyOn === this.hk[this.anyOnKey]) {
    return callback()
  }
  this.log.info(
    '%s: homekit any on changed from %s to %s', this.name,
    this.hk[this.anyOnKey], anyOn
  )
  const oldAnyOn = this.hk[this.anyOnKey]
  this.hk[this.anyOnKey] = anyOn
  const newOn = !!this.hk[this.anyOnKey]
  this.put({ on: newOn }).then(() => {
    // jshint -W106
    this.obj.state[this.anyOnKey] = newOn
    this.obj.state.all_on = newOn
    // jshint +W106
    callback()
  }).catch((error) => {
    this.hk[this.anyOnKey] = oldAnyOn
    callback(error)
  })
}

HueLight.prototype.setStreaming = function (streaming, callback) {
  streaming = streaming ? 1 : 0
  if (streaming === this.hk.streaming) {
    return callback()
  }
  this.log.info(
    '%s: homekit streaming changed from %s to %s', this.name,
    this.hk.streaming, streaming
  )
  const oldStreaming = this.hk.streaming
  this.hk.streaming = streaming
  const newStreaming = this.hk.active === 1
  this.put({ stream: { active: newStreaming } }).then((obj) => {
    this.obj.state.streaming = newStreaming
    return callback()
  }).catch((error) => {
    this.hk.streaming = oldStreaming
    return callback(error)
  })
}

HueLight.prototype.setActive = function (active, callback) {
  if (active === this.hk.active) {
    return callback()
  }
  this.log.info(
    '%s: homekit active changed from %s to %s', this.name, this.hk.active, active
  )
  const oldActive = this.hk.active
  this.hk.active = active
  const newOn = this.hk.active === 1
  this.put({ on: newOn }).then(() => {
    this.obj.state.on = newOn
    callback()
    this.didSetActive()
  }).catch((error) => {
    this.hk.active = oldActive
    callback(error)
  })
}

HueLight.prototype.setBri = function (bri, callback) {
  if (bri === this.hk.bri) {
    return callback()
  }
  this.log.info(
    '%s: homekit brightness changed from %s%% to %s%%', this.name,
    this.hk.bri, bri
  )
  const oldBri = this.hk.bri
  this.hk.bri = bri
  const newBri = Math.round(this.hk.bri * 254.0 / 100.0)
  this.put({ bri: newBri }).then(() => {
    this.obj.state.bri = newBri
    callback()
  }).catch((error) => {
    this.hk.bri = oldBri
    callback(error)
  })
}

HueLight.prototype.setBriChange = function (delta, callback) {
  if (delta === 0) {
    return callback()
  }
  this.log.info(
    '%s: homekit brightness change by %s%%', this.name,
    delta
  )
  const briDelta = Math.round(delta * 254.0 / 100.0)
  this.put({ bri_inc: briDelta }).then((obj) => {
    setTimeout(() => {
      this.service.setCharacteristic(my.Characteristics.BrightnessChange, 0)
    }, this.config.resetTimeout)
    callback()
  }).catch((error) => {
    callback(error)
  })
}

HueLight.prototype.setCT = function (ct, callback) {
  if (ct === this.hk.ct) {
    return callback()
  }
  this.log.info(
    '%s: homekit color temperature changed from %s mired to %s mired',
    this.name, this.hk.ct, ct
  )
  const oldCT = this.hk.ct
  this.hk.ct = ct
  const newCT = this.hk.ct
  this.put({ ct: newCT }).then(() => {
    this.obj.state.ct = newCT
    callback()
  }).catch((error) => {
    this.hk.ct = oldCT
    callback(error)
  })
}

HueLight.prototype.setDuration = function (duration, callback) {
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

HueLight.prototype.setHue = function (hue, callback) {
  if (hue === this.hk.hue) {
    return callback()
  }
  this.log.info(
    '%s: homekit hue changed from %s˚ to %s˚', this.name, this.hk.hue, hue
  )
  const oldHue = this.hk.hue
  this.hk.hue = hue
  if (this.config.xy) {
    const newXY = invHueSat(this.hk.hue, this.hk.sat, this.config.gamut)
    this.put({ xy: newXY }).then(() => {
      this.obj.state.xy = newXY
      callback()
    }).catch((error) => {
      this.hk.hue = oldHue
      callback(error)
    })
  } else {
    const newHue = Math.round(this.hk.hue * 65535.0 / 360.0)
    this.put({ hue: newHue }).then(() => {
      this.obj.state.hue = newHue
      callback()
    }).catch((error) => {
      this.hk.hue = oldHue
      callback(error)
    })
  }
}

HueLight.prototype.setSat = function (sat, callback) {
  if (sat === this.hk.sat) {
    return callback()
  }
  this.log.info(
    '%s: homekit saturation changed from %s%% to %s%%', this.name,
    this.hk.sat, sat
  )
  const oldSat = this.hk.sat
  this.hk.sat = sat
  if (this.config.xy) {
    const newXY = invHueSat(this.hk.hue, this.hk.sat, this.config.gamut)
    this.put({ xy: newXY }).then(() => {
      this.obj.state.xy = newXY
      callback()
    }).catch((error) => {
      this.hk.sat = oldSat
      callback(error)
    })
  } else {
    const newSat = Math.round(this.hk.sat * 254.0 / 100.0)
    this.put({ sat: newSat }).then(() => {
      this.obj.state.sat = newSat
      callback()
    }).catch((error) => {
      this.hk.sat = oldSat
      callback(error)
    })
  }
}

HueLight.prototype.setColorLoop = function (colorloop, callback) {
  if (colorloop === this.hk.colorloop) {
    return callback()
  }
  this.log.info(
    '%s: homekit colorloop changed from %s to %s', this.name,
    this.hk.colorloop, colorloop
  )
  const oldColorloop = this.hk.colorloop
  this.hk.colorloop = colorloop
  const newEffect = this.hk.colorloop ? 'colorloop' : 'none'
  this.put({ effect: newEffect }).then(() => {
    this.obj.state.effect = newEffect
    callback()
  }).catch((error) => {
    this.hk.colorloop = oldColorloop
    callback(error)
  })
}

HueLight.prototype.setPosition = function (position, callback) {
  if (position === this.hk.targetPosition) {
    return callback()
  }
  this.log.info(
    '%s: homekit target position changed from %s%% to %s%%', this.name,
    this.hk.targetPosition, position
  )
  const oldPosition = this.hk.targetPosition
  this.hk.targetPosition = position
  const newBri = Math.round((100 - this.hk.targetPosition) * 254.0 / 100.0)
  this.put({ bri: newBri }).then(() => {
    this.obj.state.bri = newBri
    const positionState = this.hk.targetPosition > this.hk.currentPosition
      ? Characteristic.PositionState.INCREASING
      : Characteristic.PositionState.DECREASING
    this.service.getCharacteristic(Characteristic.PositionState)
      .updateValue(positionState)
    callback()
  }).catch((error) => {
    this.hk.targetPosition = oldPosition
    callback(error)
  })
}

HueLight.prototype.setHoldPosition = function (hold, callback) {
  if (!hold) {
    return callback()
  }
  this.log.info('%s: homekit hold position', this.name)
  this.put({ bri_inc: 0 }).then((obj) => {
    callback()
  }).catch((error) => {
    callback(error)
  })
}

HueLight.prototype.setTilt = function (tilt, callback) {
  if (tilt === this.hk.targetTilt) {
    return callback()
  }
  this.log.info(
    '%s: homekit target tilt changed from %s° to %s°', this.name,
    this.hk.targetTilt, tilt
  )
  const oldTilt = this.hk.targetTilt
  this.hk.targetTilt = tilt
  const newSat = Math.round((90 + this.hk.targetTilt) * 254.0 / 180.0)
  this.put({ sat: newSat }).then(() => {
    this.obj.state.sat = newSat
    callback()
  }).catch((error) => {
    this.hk.targetTilt = oldTilt
    callback(error)
  })
}

HueLight.prototype.getRemainingDuration = function (callback) {
  let remaining = this.hk.autoInActive - moment().unix()
  remaining = remaining > 0 ? remaining : 0
  this.log.info('%s: remaining duration %ss', this.name, remaining)
  callback(null, remaining)
}

HueLight.prototype.didSetActive = function () {
  if (this.hk.duration > 0) {
    if (this.hk.active) {
      this.hk.autoInActive = moment().unix() + this.hk.duration
      this.hk.autoInActiveTimeout = setTimeout(() => {
        this.log.debug('%s: remaining duration 0s', this.name)
        this.put({ on: false }).then(() => {
        }).catch((error) => {
          this.log.error('%s: error %j', this.name, formatError(error))
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

// Collect changes into a combined request.
HueLight.prototype.put = function (state) {
  return new Promise((resolve, reject) => {
    for (const key in state) {
      this.desiredState[key] = state[key]
    }
    const d = { resolve: resolve, reject: reject }
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
HueLight.prototype._put = function () {
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
  this.bridge.request('put', this.resourcePath, desiredState).then((obj) => {
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
