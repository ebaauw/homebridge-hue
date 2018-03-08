// homebridge-hue/lib/HueLight.js
// Copyright © 2016-2018 Erik Baauw. All rights reserved.
//
// Homebridge plugin for Philips Hue and/or deCONZ.
//
// HueLight provides support for Philips Hue lights and groups.

'use strict'

const deferred = require('deferred')

module.exports = {
  setHomebridge: setHomebridge,
  HueLight: HueLight
}

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
      'RM01': { // 6715 U-500 with 6736-84
        fix: function () { // Issue #241
          if (this.config.bri && this.obj.type === 'On/Off light') {
            this.log.debug(
              '%s: ignoring state.bri for %s', this.resource, this.obj.type
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
  'Feibit Inc co.': { // Issue #171
  },
  'GLEDOPTO': {
    // See: https://www.led-trading.de/zigbee-kompatibel-controller-led-lichtsteuerung
    models: {
      'GLEDOPTO': { // Issue #244
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
            this.log.warn('%s: unknown light model %j', this.name, this.obj)
            return
          }
          this.log.debug('%s: set model to %s', this.name, this.model)
        }
      }
    }
  },
  'IKEA of Sweden': {
    // See: http://www.ikea.com/us/en/catalog/categories/departments/lighting/smart_lighting/
    minCT: 250,
    maxCT: 454
  },
  'innr': {
    // See: https://shop.innrlighting.com/en/shop
    gamut: { // Issue #152
      'r': [0.8817, 0.1033],
      'g': [0.2204, 0.7758],
      'b': [0.0551, 0.1940]
    },
    models: {
      'DL 110': {noAlert: true}, // Spot
      'FL 110': {noAlert: true}, // Flex Light
      'PL 110': {noAlert: true}, // Puck Light
      'SL 110 M': {noAlert: true}, // Spot, issue #166
      'SL 110 N': {noAlert: true}, // Spot, issue #166
      'SL 110 W': {noAlert: true}, // Spot, issue #166
      'ST 110': {noAlert: true}, // Strip
      'UC 110': {noAlert: true} // Under Cabinet
    }
  },
  'OSRAM': {
    maxCT: 370,
    fix: function () {
      if (this.obj.swversion === 'V1.03.07') {
        this.config.noTransitionTime = true
      }
    },
    models: {
      'LIGHTIFY Indoor Flex RGBW': { // Issue #266
        minCT: 125,
        maxCT: 666
      }
    }
  },
  'Pee': { // Issue #217
  },
  'Philips': {
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
      'LLC001': { // Living Colors Gen1 Iris
        fix: function () {
          if (this.obj.uniqueid === 'ff:ff:ff:ff:ff:ff:ff:ff-0b') {
            this.serialNumber = this.bridge.serialNumber + '-L' + this.id
          }
          this.config.xy = false
          this.config.hs = true
        },
        noWallSwitch: true
      },
      'LCT001': {gamut: 'B'}, // Hue bulb A19
      'LCT002': {gamut: 'B'}, // Hue Spot BR30
      'LCT003': {gamut: 'B'}, // Hue Spot GU10
      'LCT007': {gamut: 'B'}, // Hue bulb A19
      'LCT010': {gamut: 'C'}, // Hue bulb A19
      'LCT011': {gamut: 'C'}, // Hue BR30
      'LCT012': {gamut: 'C'}, // Hue Color Candle
      'LCT014': {gamut: 'C'}, // Hue bulb A19
      'LCT015': {gamut: 'C'}, // Hue bulb A19
      'LCT016': {gamut: 'C'}, // Hue bulb A19
      'LDT001': {maxCT: 454}, // Hue ambiance downlight
      'LFF001': {maxCT: 454}, // Hue ambiance floor
      'LLC005': {gamut: 'A'}, // Living Colors Gen3 Bloom, Aura
      'LLC006': {gamut: 'A'}, // Living Colors Gen3 Iris
      'LLC007': {gamut: 'A'}, // Living Colors Gen3 Bloom, Aura
      'LLC010': {gamut: 'A'}, // Hue Living Colors Iris
      'LLC011': {gamut: 'A'}, // Hue Living Colors Bloom
      'LLC012': {gamut: 'A'}, // Hue Living Colors Bloom
      'LLC013': {gamut: 'A'}, // Disney Living Colors
      'LLC014': {gamut: 'A'}, // Living Colors Gen3 Bloom, Aura
      'LLC020': {gamut: 'C'}, // Hue Go
      'LLM001': {gamut: 'B'}, // Color Light Module
      'LLM010': {maxCT: 454}, // Color Temperature Module
      'LLM011': {maxCT: 454}, // Color Temperature Module
      'LLM012': {maxCT: 454}, // Color Temperature Module
      'LST001': {gamut: 'A'}, // Hue LightStrips
      'LST002': {gamut: 'C'}, // Hue LightStrips Plus
      'LTC001': {maxCT: 454}, // Hue ambiance ceiling
      'LTC002': {maxCT: 454}, // Hue ambiance ceiling
      'LTC003': {maxCT: 454}, // Hue ambiance ceiling
      'LTC004': {maxCT: 454}, // Hue ambiance ceiling
      'LTD001': {maxCT: 454}, // Hue ambiance ceiling
      'LTD002': {maxCT: 454}, // Hue ambiance ceiling
      'LTD003': {maxCT: 454}, // Hue ambiance pendant
      'LTF001': {maxCT: 454}, // Hue ambiance ceiling
      'LTF002': {maxCT: 454}, // Hue ambiance ceiling
      'LTP001': {maxCT: 454}, // Hue ambiance pendant
      'LTP002': {maxCT: 454}, // Hue ambiance pendant
      'LTP003': {maxCT: 454}, // Hue ambiance pendant
      'LTP004': {maxCT: 454}, // Hue ambiance pendant
      'LTP005': {maxCT: 454}, // Hue ambiance pendant
      'LTT001': {maxCT: 454}, // Hue ambiance table
      'LTW001': {maxCT: 454}, // Hue A19 White Ambiance
      'LTW004': {maxCT: 454}, // Hue A19 White Ambiance
      'LTW010': {maxCT: 454}, // Hue A19 White Ambiance
      'LTW011': {maxCT: 454}, // Hue BR30 White Ambience
      'LTW012': {maxCT: 454}, // Hue Ambiance Candle
      'LTW013': {maxCT: 454}, // Hue GU-10 White Ambiance
      'LTW014': {maxCT: 454}, // Hue GU-10 White Ambiance
      'LTW015': {maxCT: 454} // Hue A19 White Ambiance
    }
  },
  'ShenZhen_Homa': { // PR #234, issue #235
  }
}

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
    const ap = {x: p.x - a.x, y: p.y - a.y}
    const ab = {x: b.x - a.x, y: b.y - a.y}
    let t = (ap.x * ab.x + ap.y * ab.y) / (ab.x * ab.x + ab.y * ab.y)
    t = t < 0.0 ? 0.0 : t > 1.0 ? 1.0 : t
    return {x: a.x + t * ab.x, y: a.y + t * ab.y}
  }

  const R = {x: gamut.r[0], y: gamut.r[1]}
  const G = {x: gamut.g[0], y: gamut.g[1]}
  const B = {x: gamut.b[0], y: gamut.b[1]}
  const v1 = {x: G.x - R.x, y: G.y - R.y}
  const v2 = {x: B.x - R.x, y: B.y - R.y}
  const v = crossProduct(v1, v2)
  const q = {x: p.x - R.x, y: p.y - R.y}
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
  // See: http://www.developers.meethue.com/documentation/color-conversions-rgb-xy
  const p = closestInGamut({x: xy[0], y: xy[1]}, gamut)
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
  let S = (M === 0.0) ? 0.0 : C / M
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
  return {hue: Math.round(H * 60.0), sat: Math.round(S * 100.0)}
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
  const p = sum === 0.0 ? {x: 0.0, y: 0.0} : {x: X / sum, y: Y / sum}
  const q = closestInGamut(p, gamut)
  return [Math.round(q.x * 10000) / 10000, Math.round(q.y * 10000) / 10000]
}

// ===== Homebridge ============================================================

let Service
let Characteristic
let my

function setHomebridge (homebridge, _my, _eve) {
  Service = homebridge.hap.Service
  Characteristic = homebridge.hap.Characteristic
  my = _my
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
  if (this.type === 'group' || this.obj.type.substr(-5) === 'light') {
    this.service = new Service.Lightbulb(this.name, this.subtype)
  } else {
    this.service = new Service.Outlet(this.name, this.subtype)
    this.service.getCharacteristic(Characteristic.OutletInUse)
      .setProps({perms: [Characteristic.Perms.READ, Characteristic.Perms.HIDDEN]})
      .updateValue(1)
    this.config.wallSwitch = false
  }

  this.service.getCharacteristic(Characteristic.On)
    .on('set', this.setOn.bind(this))
  if (this.type === 'group') {
    this.service.addOptionalCharacteristic(my.Characteristic.AnyOn)
    this.service.getCharacteristic(my.Characteristic.AnyOn)
      .on('set', this.setAnyOn.bind(this))
    // jshint -W106
    this.checkAllOn(this.obj.state.all_on)
    this.checkAnyOn(this.obj.state.any_on)
    // jshint +W106
  } else {
    this.checkOn(this.obj.state.on)
  }
  if (this.config.bri) {
    this.service.getCharacteristic(Characteristic.Brightness)
      .on('set', this.setBri.bind(this))
    this.checkBri(this.obj.state.bri)
  }
  if (this.config.ct) {
    this.service.addOptionalCharacteristic(Characteristic.ColorTemperature)
    this.service.getCharacteristic(Characteristic.ColorTemperature)
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
  if (this.type === 'light') {
    this.service.addOptionalCharacteristic(Characteristic.StatusFault)
    this.checkReachable(this.obj.state.reachable)
    if (this.bridge.config.nativeHomeKitLights) {
      this.service.addOptionalCharacteristic(my.Characteristic.UniqueID)
      this.service.getCharacteristic(my.Characteristic.UniqueID)
        .updateValue(this.obj.uniqueid)
    }
  }
  if (this.bridge.platform.config.resource) {
    this.service.addOptionalCharacteristic(my.Characteristic.Resource)
    this.service.getCharacteristic(my.Characteristic.Resource)
      .updateValue(this.resource)
  }
}

// Store configuration to this.config.
HueLight.prototype.setConfig = function () {
  this.config = {
    subtype: null,
    bri: this.obj.state.bri !== undefined,
    ct: this.obj.state.ct !== undefined,
    xy: this.obj.state.xy !== undefined
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
    this.version = this.bridge.version
    this.config.wallSwitch = false
    return
  }
  this.manufacturer = this.obj.manufacturername
  this.model = this.obj.modelid
  this.subtype = this.obj.uniqueid.split('-')[1]
  this.version = this.obj.swversion
  this.config.wallSwitch = this.bridge.platform.config.wallSwitch

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
      this.config.minCT = model.minCT
    } else if (manufacturer.minCT != null) {
      this.config.minCT = manufacturer.minCT
    } else if (this.obj.ctmin != null) {
      this.config.minCT = this.obj.ctmin
    }
    if (model.maxCT != null) {
      this.config.maxCT = model.maxCT
    } else if (manufacturer.maxCT != null) {
      this.config.maxCT = manufacturer.maxCT
    } else if (this.obj.ctmax != null) {
      this.config.maxCT = this.obj.ctmax
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
      this.config.gamut = manufacturer.gamuts[model.gamut]
    } else if (manufacturer.gamut != null) {
      this.config.gamut = manufacturer.gamut
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
        this.checkBri(state.bri)
        break
      case 'colormode':
        this.obj.state.colormode = state.colormode
        break
      case 'ct':
        this.checkCT(state.ct)
        break
      case 'effect':
        break
      case 'hue':
        this.checkHue(state.hue)
        break
      case 'mode':
        break
      case 'on':
        this.checkOn(state.on)
        break
      case 'reachable':
        this.checkReachable(state.reachable)
        break
      case 'sat':
        this.checkSat(state.sat)
        break
      case 'x':
        this.obj.state.x = Math.round(state.x / 6.5279) / 10000.0
        if (this.obj.state.y !== undefined) {
          const xy = [this.obj.state.x, this.obj.state.y]
          delete this.obj.state.x
          delete this.obj.state.y
          this.checkXY(xy)
        }
        break
      case 'xy':
        this.checkXY(state.xy)
        break
      case 'y':
        this.obj.state.y = Math.round(state.y / 6.5279) / 10000.0
        if (this.obj.state.y !== undefined) {
          const xy = [this.obj.state.x, this.obj.state.y]
          delete this.obj.state.x
          delete this.obj.state.y
          this.checkXY(xy)
        }
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
  if (this.obj.state.any_on !== anyOn) {
    this.log.debug(
      '%s: %s any_on changed from %s to %s', this.name, this.type,
      this.obj.state.any_on, anyOn
    )
    this.obj.state.any_on = anyOn
  }
  const hkAnyOn = this.obj.state.any_on ? 1 : 0
  if (this.hk.anyOn !== hkAnyOn) {
    if (this.hk.anyOn !== undefined) {
      this.log.info(
        '%s: set homekit any on from %s to %s', this.name,
        this.hk.anyOn, hkAnyOn
      )
    }
    this.hk.anyOn = hkAnyOn
    this.service.getCharacteristic(my.Characteristic.AnyOn)
      .updateValue(this.hk.anyOn)
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
    this.service.getCharacteristic(Characteristic.ColorTemperature)
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
    if (this.config.wallSwitch) {
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

// ===== Homekit Events ========================================================

HueLight.prototype.identify = function (callback) {
  this.log.info('%s: identify', this.name)
  if (this.config.noAlert) {
    return callback()
  }
  this.bridge.request('put', this.resourcePath, {alert: 'select'})
    .then((obj) => {
      return callback()
    }).catch((err) => {
      return callback(err)
    })
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
  const request = {on: newOn}
  if (this.config.noTransitionTime && !newOn) {
    request.transitiontime = 0
  }
  this.request(request).then(() => {
    if (this.type === 'group') {
      // jshint -W106
      this.obj.state.any_on = newOn
      this.obj.state.all_on = newOn
      // jshint +W106
    } else {
      this.obj.state.on = newOn
    }
    callback()
  }).catch((err) => {
    this.hk.on = oldOn
    callback(err)
  })
}

HueLight.prototype.setAnyOn = function (anyOn, callback) {
  anyOn = anyOn ? 1 : 0
  if (anyOn === this.hk.anyOn) {
    return callback()
  }
  this.log.info(
    '%s: homekit any on changed from %s to %s', this.name, this.hk.anyOn, anyOn
  )
  const oldAnyOn = this.hk.anyOn
  this.hk.anyOn = anyOn
  const newOn = !!this.hk.anyOn
  this.request({on: newOn}).then(() => {
    // jshint -W106
    this.obj.state.any_on = newOn
    this.obj.state.all_on = newOn
    // jshint +W106
    callback()
  }).catch((err) => {
    this.hk.anyOn = oldAnyOn
    callback(err)
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
  this.request({bri: newBri}).then(() => {
    this.obj.state.bri = newBri
    callback()
  }).catch((err) => {
    this.hk.bri = oldBri
    callback(err)
  })
}

HueLight.prototype.setCT = function (ct, callback) {
  if (ct === this.obj.state.ct) {
    return callback()
  }
  this.log.info(
    '%s: homekit color temperature changed from %s mired to %s mired',
    this.name, this.hk.ct, ct)
  const oldCT = this.hk.ct
  this.hk.ct = ct
  const newCT = this.hk.ct
  this.request({ct: newCT}).then(() => {
    this.obj.state.ct = newCT
    callback()
  }).catch((err) => {
    this.hk.ct = oldCT
    callback(err)
  })
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
    this.request({xy: newXY}).then(() => {
      this.obj.state.xy = newXY
      callback()
    }).catch((err) => {
      this.hk.hue = oldHue
      callback(err)
    })
  } else {
    const newHue = Math.round(this.hk.hue * 65535.0 / 360.0)
    this.request({hue: newHue}).then(() => {
      this.obj.state.hue = newHue
      callback()
    }).catch((err) => {
      this.hk.hue = oldHue
      callback(err)
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
    this.request({xy: newXY}).then(() => {
      this.obj.state.xy = newXY
      callback()
    }).catch((err) => {
      this.hk.sat = oldSat
      callback(err)
    })
  } else {
    const newSat = Math.round(this.hk.sat * 254.0 / 100.0)
    this.request({sat: newSat}).then(() => {
      this.obj.state.sat = newSat
      callback()
    }).catch((err) => {
      this.hk.sat = oldSat
      callback(err)
    })
  }
}

// Collect changes into a combined request.
HueLight.prototype.request = function (state) {
  const d = deferred()

  for (const key in state) {
    this.desiredState[key] = state[key]
  }
  this.deferrals.push(d)
  if (this.updating) {
    return d.promise
  }
  this.updating = true
  if (this.bridge.platform.config.waitTimeUpdate) {
    setTimeout(() => {
      this.put()
    }, this.bridge.platform.config.waitTimeUpdate)
  } else {
    this.put()
  }
  return d.promise
}

// Send the request (for the combined changes) to the Hue bridge.
HueLight.prototype.put = function () {
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
  this.bridge.request('put', this.resourcePath, desiredState)
    .then((obj) => {
      for (const d of deferrals) {
        d.resolve(true)
      }
    }).catch((err) => {
      for (const d of deferrals) {
        d.reject(err)
      }
    })
}
