// homebridge-hue/lib/HueLight.js
// Copyright © 2016, 2017 Erik Baauw. All rights reserved.
//
// Homebridge plugin for Philips Hue.
//
// HueLight provides support for Philips Hue lights and groups.

'use strict';

module.exports = {
  setHomebridge: setHomebridge,
  HueLight: HueLight
};

const knownLights = {
  'Busch-Jaeger': {
    // See: https://www.busch-jaeger.de/en/products/product-solutions/dimmer/busch-radio-controlled-dimmer-zigbee-light-link/
    models: {
      'RM01':                             {}                        // 6715 U-500 with 6736-84
    }
  },
  'CREE                           ': {
    models: {
      'Connected A-19 60W Equivalent  ':  {}                        // Issue #157
    }
  },
  'dresden elektronik': {
    // See: https://www.dresden-elektronik.de/funktechnik/solutions/wireless-light-control/wireless-ballasts/?L=1
    models: {
      'FLS-CT':                           {},                       //
      'FLS-PP3':                          {multiLight: true},       // FLS-PP lp
      'FLS-PP3 White':                    {multiLight: true}        // FLS-PP lp
    }
  },
  'Feibit Inc co.': {
    models: {
      'FB56-ZCW08KU1.1':                  {}                        // issue #171
    }
  },
  'GE': {
    models: {
      'Daylight':                         {}                        // Issue #157
    }
  },
  'GE_Appliances': {
    models: {
      'ZLL Light':                        {}                        //
    }
  },
  'IKEA of Sweden': {
    // See: http://www.ikea.com/us/en/catalog/categories/departments/lighting/smart_lighting/
    minCT: 250,
    maxCT: 454,
    models: {
      'FLOALT panel WS 30x30':            {},                       // issue #215
      'TRADFRI bulb E14 WS opal 400lm':   {},
      'TRADFRI bulb E27 CWS opal 600lm':  {},
      'TRADFRI bulb E27 W opal 1000lm':   {},
      'TRADFRI bulb E27 WS opal 980lm':   {},
      /* jshint -W100 */
      'TRADFRI bulb E27 WS�opal 980lm':   {},                       // old firmware
      /* jshint +W100 */
      'TRADFRI bulb E27 opal 1000lm':     {},                       // old firmware?
      'TRADFRI bulb GU10 W 400lm':        {},                       // issue #173
      'TRADFRI bulb GU10 WS 400lm':       {}
    }
  },
  'innr': {
    // See: https://shop.innrlighting.com/en/shop
    gamut: {
      "r": [0.8817, 0.1033],
      "g": [0.2204, 0.7758],
      "b": [0.0551, 0.1940]
    },
    models: {
      'DL 110':                           {noAlert: true},          // Spot
      'FL 110':                           {noAlert: true},          // Flex Light
      'PL 110':                           {noAlert: true},          // Puck Light
      'RB 162':                           {},                       // Bulb
      'RB 165':                           {},                       // Bulb
      'RB 185 C':                         {},                       // Issue #152
      'RS 125':                           {},                       // GU-10
      'SL 110 M':                         {noAlert: true},          // Spot, issue #166
      'SL 110 N':                         {noAlert: true},          // Spot, issue #166
      'SL 110 W':                         {noAlert: true},          // Spot, issue #166
      'ST 110':                           {noAlert: true},          // Strip
      'UC 110':                           {noAlert: true}           // Under Cabinet
    }
  },
  'LUMI': {
    models: {
      'lumi.plug':                        {ignoreReachable: true}   // issue #188
    }
  },
  'MRVL': {
    models: {
      'MZ100':                            {}                        // issue #195
    }
  },
  'OSRAM': {
    maxCT: 370,
    fix: function() {
      if (this.obj.swversion === 'V1.03.07') {
        this.config.noTransitionTime = true;
      }
    },
    models: {
      'Classic A60 RGBW':                 {},                       //
      'Classic A60 TW':                   {},                       // Issue #178
      'Classic A60 W clear - LIGHTIFY':   {},                       // Issue #178
      'Classic B40 TW - LIGHTIFY':        {},                       // E14
      'Control box TW':                   {},                       // Issue #155
      'Gardenspot RGB':                   {},                       //
      'Gardenspot W':                     {},                       //
      'PAR16 50 TW':                      {},                       //
      'Plug - LIGHTIFY':                  {ignoreReachable: true},  // Old plug
      'Plug 01':                          {ignoreReachable: true},  // New plug
      'Surface Light TW':                 {}                        // Issue #196
    }
  },
  'Pee': {
    // See: https://github.com/peeveeone/ZLL_Lights
    models: {
      'PeeVeeOne':                         {multiLight: true}        //
    }
  },
  'Philips': {
    // See: http://www.developers.meethue.com/documentation/supported-lights
    gamuts: { // Color gamut per light model.
      A: {    // Color Lights
        r: [0.7040, 0.2960],
        g: [0.2151, 0.7106],
        b: [0.1380, 0.0800]
      },
      B: {    // Extended Color Lights
        r: [0.6750, 0.3220],
        g: [0.4090, 0.5180],
        b: [0.1670, 0.0400]
      },
      C: {    // next gen Extended Color Lights
        r: [0.6920, 0.3080],
        g: [0.1700, 0.7000],
        b: [0.1530, 0.0480]
      }
    },
    models: {
      'LLC001': {                                                   // Living Colors Gen1 Iris
          fix: function() {
            if (this.obj.uniqueid === 'ff:ff:ff:ff:ff:ff:ff:ff-0b') {
              // jshint -W106
              this.config.serialNumber = this.bridge.uuid_base + this.resource;
            }
            this.config.xy = false;
            this.config.hs = true;
          },
          ignoreReachable: true
      },
      'LCT001':                           {gamut: 'B'},             // Hue bulb A19
      'LCT002':                           {gamut: 'B'},             // Hue Spot BR30
      'LCT003':                           {gamut: 'B'},             // Hue Spot GU10
      'LCT007':                           {gamut: 'B'},             // Hue bulb A19
      'LCT010':                           {gamut: 'C'},             // Hue bulb A19
      'LCT011':                           {gamut: 'C'},             // Hue BR30
      'LCT012':                           {gamut: 'C'},             // Hue Color Candle
      'LCT014':                           {gamut: 'C'},             // Hue bulb A19
      'LCT015':                           {gamut: 'C'},             // Hue bulb A19
      'LCT016':                           {gamut: 'C'},             // Hue bulb A19
      'LDD001':                           {},                       // Hue white table
      'LDD002':                           {},                       // Hue white floor
      'LDF001':                           {},                       // Hue white ceiling
      'LDF002':                           {},                       // Hue white wall washer
      'LDT001':                           {maxCT: 454},             // Hue ambiance downlight
      'LFF001':                           {maxCT: 454},             // Hue ambiance floor
      'LLC005':                           {gamut: 'A'},             // Living Colors Gen3 Bloom, Aura
      'LLC006':                           {gamut: 'A'},             // Living Colors Gen3 Iris
      'LLC007':                           {gamut: 'A'},             // Living Colors Gen3 Bloom, Aura
      'LLC010':                           {gamut: 'A'},             // Hue Living Colors Iris
      'LLC011':                           {gamut: 'A'},             // Hue Living Colors Bloom
      'LLC012':                           {gamut: 'A'},             // Hue Living Colors Bloom
      'LLC013':                           {gamut: 'A'},             // Disney Living Colors
      'LLC014':                           {gamut: 'A'},             // Living Colors Gen3 Bloom, Aura
      'LLC020':                           {gamut: 'C'},             // Hue Go
      'LLM001':                           {gamut: 'B'},             // Color Light Module
      'LLM010':                           {maxCT: 454},             // Color Temperature Module
      'LLM011':                           {maxCT: 454},             // Color Temperature Module
      'LLM012':                           {maxCT: 454},             // Color Temperature Module
      'LST001':                           {gamut: 'A'},             // Hue LightStrips
      'LST002':                           {gamut: 'C'},             // Hue LightStrips Plus
      'LTC001':                           {maxCT: 454},             // Hue ambiance ceiling
      'LTC002':                           {maxCT: 454},             // Hue ambiance ceiling
      'LTC003':                           {maxCT: 454},             // Hue ambiance ceiling
      'LTC004':                           {maxCT: 454},             // Hue ambiance ceiling
      'LTD001':                           {maxCT: 454},             // Hue ambiance ceiling
      'LTD002':                           {maxCT: 454},             // Hue ambiance ceiling
      'LTD003':                           {maxCT: 454},             // Hue ambiance pendant
      'LTF001':                           {maxCT: 454},             // Hue ambiance ceiling
      'LTF002':                           {maxCT: 454},             // Hue ambiance ceiling
      'LTP001':                           {maxCT: 454},             // Hue ambiance pendant
      'LTP002':                           {maxCT: 454},             // Hue ambiance pendant
      'LTP003':                           {maxCT: 454},             // Hue ambiance pendant
      'LTP004':                           {maxCT: 454},             // Hue ambiance pendant
      'LTP005':                           {maxCT: 454},             // Hue ambiance pendant
      'LTT001':                           {maxCT: 454},             // Hue ambiance table
      'LTW001':                           {maxCT: 454},             // Hue A19 White Ambiance
      'LTW004':                           {maxCT: 454},             // Hue A19 White Ambiance
      'LTW010':                           {maxCT: 454},             // Hue A19 White Ambiance
      'LTW011':                           {maxCT: 454},             // Hue BR30 White Ambience
      'LTW012':                           {maxCT: 454},             // Hue Ambiance Candle
      'LTW013':                           {maxCT: 454},             // Hue GU-10 White Ambiance
      'LTW014':                           {maxCT: 454},             // Hue GU-10 White Ambiance
      'LTW015':                           {maxCT: 454},             // Hue A19 White Ambiance
      'LWB001':                           {},                       // Living White, issue #157
      'LWB004':                           {},                       // Hue A19 lux
      'LWB006':                           {},                       // Hue A19 lux
      'LWB007':                           {},                       // Hue A19 lux
      'LWB010':                           {},                       // Hue A19 lux
      'LWB014':                           {},                       // Hue A19 lux
      'LWL001':                           {ignoreReachable: true},  // Dimmable plug-in unit
      'MWM001':                           {}                        // Hue white 1-10V
    }
  },
  'ShenZhen_Homa': {
    models: {
      'HOMA1001':                         {multiLight: true},       // PR #234, issue #235
      'HOMA1002':                         {multiLight: true},       //
      'HOMA1003':                         {multiLight: true},       //
      'HOMA1004':                         {multiLight: true}        //
    }
  },
  'ubisys': {
    models: {
      'D1 (5503)':                        {}                        //
    }
  }
};

// ===== Homebridge ============================================================

let Accessory;
let Service;
let Characteristic;

function setHomebridge(homebridge) {
  Accessory = homebridge.platformAccessory;
  Service = homebridge.hap.Service;
  Characteristic = homebridge.hap.Characteristic;
}

// Return point in color gamut closest to p.
function closestInGamut(p, gamut) {
  // Return cross product of two points.
  function crossProduct(p1, p2) {
    return p1.x * p2.y - p1.y * p2.x;
  }

  // Return distance between two points.
  function distance(p1, p2) {
    const dx = p1.x - p2.x;
    const dy = p1.y - p2.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  // Return point on line a,b closest to p.
  function closest(a, b, p) {
    const ap = {x: p.x - a.x, y: p.y - a.y};
    const ab = {x: b.x - a.x, y: b.y - a.y};
    let t =  (ap.x * ab.x + ap.y * ab.y) / (ab.x * ab.x + ab.y * ab.y);
    t = t < 0.0 ? 0.0 : t > 1.0 ? 1.0 : t;
    return {x: a.x + t * ab.x, y: a.y + t * ab.y};
  }

  const R = {x: gamut.r[0], y: gamut.r[1]};
  const G = {x: gamut.g[0], y: gamut.g[1]};
  const B = {x: gamut.b[0], y: gamut.b[1]};
  const v1 = {x: G.x - R.x, y: G.y - R.y};
  const v2 = {x: B.x - R.x, y: B.y - R.y};
  const v = crossProduct(v1, v2);
  const q = {x: p.x - R.x, y: p.y - R.y};
  const s = crossProduct(q, v2) / v;
  const t = crossProduct(v1, q) / v;
  if (s >= 0.0 && t >= 0.0 && s + t <= 1.0) {
    return p;
  }
  const pRG = closest(R, G, p);
  const pGB = closest(G, B, p);
  const pBR = closest(B, R, p);
  const dRG = distance(p, pRG);
  const dGB = distance(p, pGB);
  const dBR = distance(p, pBR);
  let min = dRG;
  p = pRG;
  if (dGB < min) {
    min = dGB;
    p = pGB;
  }
  if (dBR < min) {
    p = pBR;
  }
  return p;
}

// Transform bridge xy values [0.0000, 1.0000]
// to homekit hue value [0˚, 360˚] and saturation value [0%, 100%].
function hueSat(xy, gamut) {
  // Inverse Gamma correction (sRGB Companding).
  function compand(v) {
    return v <= 0.0031308 ?
      12.92 * v : (1.0 + 0.055) * Math.pow(v, (1.0 / 2.4)) - 0.055;
  }

  function rescale() {
    if (R > G && R > B && R > 1.0) {
      G /= R; B /= R; R = 1.0;
    } else if (G > R && G > B && G > 1.0) {
      R /= G; B /= G; G = 1.0;
    } else if (B > R && B > G && B > 1.0) {
      R /= B; G /= B; B = 1.0;
    }
  }

  // xyY to XYZ to RGB
  // See: http://www.developers.meethue.com/documentation/color-conversions-rgb-xy
  const p = closestInGamut({x: xy[0], y: xy[1]}, gamut);
  const x = p.x;
  const y = p.y === 0.0 ? 0.0001 : p.y;
  const z = 1.0 - x - y;
  const Y = 1.0;
  const X = (Y / y) * x;
  const Z = (Y / y) * z;
  let R = X *  1.656492 + Y * -0.354851 + Z * -0.255038;
  let G = X * -0.707196 + Y *  1.655397 + Z *  0.036152;
  let B = X *  0.051713 + Y * -0.121364 + Z *  1.011530;
  rescale();
  R = compand(R);
  G = compand(G);
  B = compand(B);
  rescale();

  // RGB to HSV
  // See: https://en.wikipedia.org/wiki/HSL_and_HSV
  const M = Math.max(R, G, B);
  const m = Math.min(R, G, B);
  const C = M - m;
  let S = (M === 0.0) ? 0.0 : C / M;
  S = S > 1.0 ? 1.0 : S;			// Deal with negative RGB.
  let H;
  switch (M) {
    case m:
      H = 0.0;
      break;
    case R:
      H = (G - B) / C;
      if (H < 0) {
        H += 6.0;
      }
      break;
    case G:
      H = (B - R) / C;
      H += 2.0;
      break;
    case B:
      H = (R - G) / C;
      H += 4.0;
      break;
  }
  H /= 6.0;
  return { hue: Math.round(H * 360), sat: Math.round(S * 100) };
}

// Transform homekit hue value [0˚, 360˚] and saturation value [0%, 100%]
// to bridge xy values [0.0, 1.0].
function invHueSat(hue, sat, gamut) {
  // Gamma correction (inverse sRGB Companding).
  function invCompand(v) {
    return v > 0.04045 ? Math.pow((v + 0.055) / (1.0 + 0.055), 2.4) : v / 12.92;
  }

  // HSV to RGB
  // See: https://en.wikipedia.org/wiki/HSL_and_HSV
  let H = hue / 360.0;
  const S = sat / 100.0;
  const V = 1;
  const C = V * S;
  H *= 6;
  const m = V - C;
  let x = (H % 2) - 1.0;
  if (x < 0) {
    x = -x;
  }
  x = C * (1.0 - x);
  let R, G, B;
  switch (Math.floor(H) % 6) {
    case 0: R = C + m; G = x + m; B = m;     break;
    case 1: R = x + m; G = C + m; B = m;     break;
    case 2: R = m;     G = C + m; B = x + m; break;
    case 3: R = m;     G = x + m; B = C + m; break;
    case 4: R = x + m; G = m;     B = C + m; break;
    case 5: R = C + m; G = m;     B = x + m; break;
  }

  // RGB to XYZ to xyY
  // See: http://www.developers.meethue.com/documentation/color-conversions-rgb-xy
  const linearR = invCompand(R);
  const linearG = invCompand(G);
  const linearB = invCompand(B);
  const X = linearR * 0.664511 + linearG * 0.154324 + linearB * 0.162028;
  const Y = linearR * 0.283881 + linearG * 0.668433 + linearB * 0.047685;
  const Z = linearR * 0.000088 + linearG * 0.072310 + linearB * 0.986039;
  const sum = X + Y + Z;
  const p = sum === 0.0 ? {x: 0.0, y: 0.0} : {x: X / sum, y: Y / sum};
  const q = closestInGamut(p, gamut);
  return [Math.round(q.x * 10000) / 10000, Math.round(q.y * 10000) / 10000];
}

// ===== HueLight ==============================================================

function HueLight(bridge, id, obj, type) {
  // jshint -W106
  this.log = bridge.log;
  this.bridge = bridge;
  this.name = obj.name;
  this.type = type || 'light';
  this.obj = obj;
  this.resource = '/' + this.type + 's/' + id;
  this.key = this.type === 'group' ? 'action' : 'state';
  this.resourcePath = this.resource + '/' + this.key;

  this.setConfig();
  this.uuid_base = this.config.serialNumber;
  this.infoService = new Service.AccessoryInformation();
  this.serviceList = [this.infoService];
  this.infoService
    .updateCharacteristic(Characteristic.Manufacturer, this.config.manufacturer)
    .updateCharacteristic(Characteristic.Model, this.config.model)
    .updateCharacteristic(Characteristic.SerialNumber, this.config.serialNumber)
    .updateCharacteristic(Characteristic.FirmwareRevision, this.config.version);
  if (this.config.bri) {
    this.service = new Service.Lightbulb(this.name, this.config.subtype);
  } else {
    this.service = new Service.Switch(this.name, this.config.subtype);
  }
  this.serviceList.push(this.service);

  this.setHK();
  this.service.getCharacteristic(Characteristic.On)
    .updateValue(this.hk.on)
    .on('set', this.setOn.bind(this));
  if (this.type === 'group') {
    this.service.addOptionalCharacteristic(Characteristic.AnyOn);
    this.service.getCharacteristic(Characteristic.AnyOn)
      .updateValue(this.hk.any_on)
      .on('set', this.setAnyOn.bind(this));
  }
  if (this.config.bri) {
    this.service.getCharacteristic(Characteristic.Brightness)
      .updateValue(this.hk.bri)
      .on('set', this.setBri.bind(this));
  }
  if (this.config.ct) {
    this.service.addOptionalCharacteristic(Characteristic.ColorTemperature);
    this.service.getCharacteristic(Characteristic.ColorTemperature)
      .updateValue(this.state.ct)
      .on('set', this.setCT.bind(this))
      .setProps({
        minValue: this.config.minCT,
        maxValue: this.config.maxCT
      });
  }
  if (this.config.xy || this.config.hs) {
    this.service.getCharacteristic(Characteristic.Hue)
      .updateValue(this.hk.hue)
      .on('set', this.setHue.bind(this));
    this.service.getCharacteristic(Characteristic.Saturation)
      .updateValue(this.hk.sat)
      .on('set', this.setSat.bind(this));
  }
  if (this.type === 'light') {
    this.service.addOptionalCharacteristic(Characteristic.StatusFault);
    this.service.getCharacteristic(Characteristic.StatusFault)
      .updateValue(this.hk.fault);
    if (this.bridge.config.nativeHomeKit) {
      this.service.addOptionalCharacteristic(Characteristic.UniqueID);
      this.service.getCharacteristic(Characteristic.UniqueID)
        .updateValue(this.obj.uniqueid);
    }
  }
  if (this.bridge.platform.config.resource) {
    this.service.addOptionalCharacteristic(Characteristic.Resource);
    this.service.getCharacteristic(Characteristic.Resource)
      .updateValue(this.resource);
  }
}

HueLight.prototype.getServices = function() {
  return this.serviceList;
};

// Store bridge state to this.state.
HueLight.prototype.setState = function() {
  this.state = this.obj.state;
  for (const key in this.obj.action) {
    this.state[key] = this.obj.action[key];
  }
};

// Store configuration to this.config.
HueLight.prototype.setConfig = function() {
  // jshint -W106
  this.setState();
  this.config = {
    subtype: null,
    bri: this.state.bri !== undefined,
    // ct: this.state.ct !== undefined && this.state.xy === undefined,
    ct: this.state.ct !== undefined,
    xy: this.state.xy !== undefined
  };
  if (this.config.ct) {
    // Default colour temperature range: 153 (~6500K) - 500 (2000K).
    this.config.minCT = 153;
    this.config.maxCT = 500;
  }
  if (this.config.xy) {
    this.config.gamut = { // Default colour gamut.
      r: [1.0000, 0.0001],
      g: [0.0000, 1.0000],
      b: [0.0000, 0.0001]
    };
  }
  if (this.type === 'group') {
    this.config.manufacturer = this.bridge.obj.manufacturername;
    this.config.model = this.obj.type;
    this.config.serialNumber = this.bridge.uuid_base + this.resource;
    this.config.version = this.bridge.version;
    this.config.ignoreReachable = true;
    return;
  }
  this.config.manufacturer = this.obj.manufacturername;
  this.config.model = this.obj.modelid;
  this.config.serialNumber = this.obj.uniqueid.split('-')[0];
  // this.config.subtype = this.obj.uniqueid.split('-')[1];
  this.config.version = this.obj.swversion;
  this.config.ignoreReachable = !this.bridge.platform.config.wallSwitch;

  const manufacturer = knownLights[this.obj.manufacturername] || {models: {}};
  const model = manufacturer.models[this.obj.modelid] || {};
  if (this.config.ct) {
    if (model.minCT !== undefined) {
      this.config.minCT = model.minCT;
    } else if (manufacturer.minCT !== undefined) {
      this.config.minCT = manufacturer.minCT;
    } else if (this.obj.ctmin !== undefined) {
      this.config.minCT = this.obj.ctmin;
    }
    if (model.maxCT !== undefined) {
      this.config.maxCT = model.maxCT;
    } else if (manufacturer.maxCT !== undefined) {
      this.config.maxCT = manufacturer.maxCT;
    } else if (this.obj.ctmax !== undefined) {
      this.config.maxCT = this.obj.ctmax;
    } else if (manufacturer.models[this.obj.modelid] === undefined) {
      this.log.warn(
        '%s: %s: warning: using default colour temperature range for unknown light model %j',
        this.bridge.name, this.resource, this.obj
      );
    }
  }
  if (this.config.xy) {
    if (model.gamut !== undefined && manufacturer.gamuts !== undefined) {
      this.config.gamut = manufacturer.gamuts[model.gamut];
    } else if (manufacturer.gamut !== undefined) {
      this.config.gamut = manufacturer.gamut;
    } else if (manufacturer.models[this.obj.modelid] === undefined) {
      this.log.warn(
        '%s: %s: warning: using default colour gamut for unknown light model %j',
        this.bridge.name, this.resource, this.obj
      );
    }
  }
  if (model.noAlert) {
    this.config.noAlert = true;
  }
  if (model.ignoreReachable) {
    this.config.ignoreReachable = true;
  }
  if (model.multiLight) {
    this.config.subtype = this.obj.uniqueid.split('-')[1];
  }
  if (typeof model.fix === 'function') {
    model.fix.call(this);
  } else if (typeof manufacturer.fix === 'function') {
    manufacturer.fix.bind(this);
  }
  if (manufacturer.models[this.obj.modelid] === undefined) {
    this.log.debug(
      '%s: %s: warning: unknown light model %j',
      this.bridge.name, this.resource, this.obj
    );
  }
};

// Store desired HomeKit state to this.hk.
HueLight.prototype.setHK = function() {
  // jshint -W106
  this.setState();
  this.hk = {};
  if (this.type === 'group') {
    this.hk.on = this.state.all_on ? 1 : 0;
    this.hk.any_on = this.state.any_on ? 1 : 0;
  } else {
    this.hk.on = this.state.on ? 1 : 0;
    this.hk.fault = this.state.reachable ? 0 : 1;
  }
  if (this.config.bri) {
    this.hk.bri = Math.round(this.state.bri * 100.0 / 254.0);
  }
  if (this.config.xy) {
    const hs = hueSat(this.state.xy, this.config.gamut);
    this.hk.hue = hs.hue;
    this.hk.sat = hs.sat;
  } else if (this.config.hs) {
    this.hk.hue = Math.round(this.state.hue * 360.0 / 65535.0);
    this.hk.sat = Math.round(this.state.sat * 100.0 / 254.0);
  }
};

// ===== Bridge Events =========================================================

HueLight.prototype.heartbeat = function(obj) {
  // jshint -W106
  if (this.updating) {
    return;
  }
  const old = {
    state: this.state,
    hk: this.hk
  };
  this.obj = obj;
  this.setHK();
  if (this.state.reachable !== old.state.reachable) {
    this.log.debug(
      '%s: %s reachable changed from %s to %s', this.name, this.type,
      old.state.reachable, this.state.reachable
    );
  }
  if (this.hk.fault !== old.hk.fault) {
    this.log.info(
      '%s: set homekit status fault from %s to %s', this.name,
      old.hk.fault, this.hk.fault
    );
    this.service.getCharacteristic(Characteristic.StatusFault)
      .updateValue(this.hk.fault);
  }
  if (this.state.on !== old.state.on) {
    this.log.debug(
      '%s: %s on changed from %s to %s', this.name, this.type,
    	old.state.on, this.state.on
    );
  }
  if (this.state.all_on !== old.state.all_on) {
    this.log.debug(
      '%s: %s all_on changed from %s to %s', this.name, this.type,
    	old.state.all_on, this.state.all_on
    );
  }
  if (this.hk.on && !this.config.ignoreReachable && !this.state.reachable) {
    this.log.info(
      '%s: not reachable: set homekit power from %s to %s', this.name,
      this.hk.on, 0
    );
    this.hk.on = 0;
    this.service.getCharacteristic(Characteristic.On)
      .setValue(this.hk.on);
  } else if (this.hk.on !== old.hk.on) {
    this.log.info(
      '%s: set homekit power from %s to %s', this.name,
    	old.hk.on, this.hk.on
    );
    this.service.getCharacteristic(Characteristic.On)
      .updateValue(this.hk.on);
  }
  if (this.state.any_on !== old.state.any_on) {
    this.log.debug(
      '%s: %s any_on changed from %s to %s', this.name, this.type,
    	old.state.any_on, this.state.any_on
    );
  }
  if (this.hk.any_on !== old.hk.any_on) {
    this.log.info(
      '%s: set homekit any on from %s to %s', this.name,
    	old.hk.any_on, this.hk.any_on
    );
    this.service.getCharacteristic(Characteristic.AnyOn)
      .updateValue(this.hk.any_on);
  }
  if (this.state.bri !== old.state.bri) {
    this.log.debug(
      '%s: %s bri changed from %s to %s', this.name, this.type,
    	old.state.bri, this.state.bri
    );
  }
  if (this.hk.bri !== old.hk.bri) {
    this.log.info(
      '%s: set homekit brightness from %s%% to %s%%', this.name,
    	old.hk.bri, this.hk.bri
    );
    this.service.getCharacteristic(Characteristic.Brightness)
      .updateValue(this.hk.bri);
  }
  if (this.config.ct && this.state.ct !== old.state.ct) {
    if (this.state.colormode === 'ct') {
      this.log.debug(
        '%s: %s ct changed from %s to %s', this.name, this.type,
      	old.state.ct, this.state.ct
      );
    } else {
      this.log.debug(
        '%s: %s ct updated by %s from %s to %s', this.name, this.type,
        this.state.colormode, old.state.ct, this.state.ct
      );
    }
    this.log.info(
      '%s: set homekit color temperature from %s mired to %s mired',
      this.name, old.state.ct, this.state.ct
    );
    this.service.getCharacteristic(Characteristic.ColorTemperature)
      .updateValue(this.state.ct);
  }
  if (this.state.hue !== old.state.hue) {
    if (this.state.colormode === 'hs') {
      this.log.debug(
        '%s: %s hue changed from %s to %s', this.name, this.type,
        old.state.hue, this.state.hue
      );
    } else {
      this.log.debug(
        '%s: %s hue changed by %s from %s to %s', this.name, this.type,
        this.state.colormode, old.state.hue, this.state.hue
      );
    }
  }
  if (this.state.sat !== old.state.sat) {
    if (this.state.colormode === 'hs') {
      this.log.debug(
        '%s: %s sat changed from %s to %s', this.name, this.type,
        old.state.sat, this.state.sat
      );
    } else {
      this.log.debug(
        '%s: %s sat changed by %s from %s to %s', this.name, this.type,
        this.state.colormode, old.state.sat, this.state.sat
      );
    }
  }
  if (
    this.config.xy && (
      this.state.xy[0] !== old.state.xy[0] ||
      this.state.xy[1] !== old.state.xy[1]
    )
  ) {
    if (this.state.colormode === 'xy') {
      this.log.debug(
        '%s: %s xy changed from %j to %j', this.name, this.type,
      	old.state.xy, this.state.xy
      );
    } else {
      this.log.debug(
        '%s: %s xy changed by %s from %j to %j', this.name, this.type,
      	this.state.colormode, old.state.xy, this.state.xy
      );
    }
  }
  if (this.hk.hue !== old.hk.hue) {
    this.log.info(
      '%s: set homekit hue from %s˚ to %s˚', this.name, old.hk.hue, this.hk.hue
    );
    this.service.getCharacteristic(Characteristic.Hue)
      .updateValue(this.hk.hue);
  }
  if (this.hk.hue !== old.hk.hue) {
    this.log.info(
      '%s: set homekit saturation from %s%% to %s%%', this.name,
      old.hk.sat, this.hk.sat
    );
    this.service.getCharacteristic(Characteristic.Saturation)
      .updateValue(this.hk.sat);
  }
};

HueLight.prototype.checkState = function(state, event) {
  // jshint -W106
  if (state.on !== undefined && state.on !== this.state.on) {
    this.log.debug(
      '%s: event: %s on changed from %s to %s', this.name, this.type,
      this.state.on, state.on
    );
    this.state.on = state.on;
    const on = this.state.on ? 1 : 0;
    if (on !== this.hk.on) {
      this.log.info(
        '%s: set homekit power from %s to %s', this.name,
      	this.hk.on, on
      );
      this.hk.on = on;
      this.service.getCharacteristic(Characteristic.On)
        .updateValue(this.hk.on);
    }
  }
  if (state.any_on !== undefined && state.any_on !== this.state.any_on) {
    this.log.debug(
      '%s: event: %s any_on changed from %s to %s', this.name, this.type,
      this.state.any_on, state.any_on
    );
    this.state.any_on = state.any_on;
    const any_on = this.state.any_on ? 1 : 0;
    if (any_on !== this.hk.any_on) {
      this.log.info(
        '%s: set homekit any on from %s to %s', this.name,
        this.hk.any_on, any_on
      );
      this.hk.any_on = any_on;
      this.service.getCharacteristic(Characteristic.AnyOn)
        .updateValue(this.hk.any_on);
    }
  }
  if (state.bri !== undefined && state.bri !== this.state.bri) {
    this.log.debug(
      '%s: event: %s bri changed from %s to %s', this.name, this.type,
      this.state.bri, state.bri
    );
    this.state.bri = state.bri;
    const bri = Math.round(this.state.bri * 100.0 / 254.0);
    if (bri !== this.hk.bri) {
      this.log.info(
        '%s: set homekit brightness from %s%% to %s%%', this.name,
        this.hk.bri, bri
      );
      this.hk.bri = bri;
      this.service.getCharacteristic(Characteristic.Brightness)
        .updateValue(this.hk.bri);
    }
  }
  if (state.ct !== undefined && state.ct !== this.state.ct) {
    this.log.debug(
      '%s: event: %s ct changed from %s to %s', this.name, this.type,
      this.state.ct, state.ct
    );
    this.log.info(
      '%s: set homekit color temperature from %s mired to %s mired',
      this.name, this.state.ct, state.ct
    );
    this.service.getCharacteristic(Characteristic.ColorTemperature)
      .updateValue(state.ct);
    this.state.ct = state.ct;
  }
};

// ===== Homekit Events ========================================================

HueLight.prototype.identify = function(callback) {
  this.log.info('%s: identify', this.name);
  if (this.config.noAlert) {
    return callback();
  }
  this.bridge.request('put', this.resourcePath, {alert: 'select'})
  .then(function(obj) {
    return callback();
  }.bind(this))
  .catch(function(err) {
    return callback(new Error(err));
  }.bind(this));
};

HueLight.prototype.setOn = function(on, callback) {
  on = on ? 1 : 0;
  if (on !== this.hk.on) {
    this.log.info(
      '%s: homekit power changed from %s to %s', this.name, this.hk.on, on
    );
    this.hk.on = on;
  }
  const newOn = this.hk.on ? true : false;
  this.request('on', newOn);
  if (this.config.noTransitionTime && !newOn) {
    this.request('transitiontime', 0);
  }
  return callback();
};

HueLight.prototype.setAnyOn = function(on, callback) {
  // jshint -W106
  on = on ? 1 : 0;
  if (on === this.hk.any_on) {
    return callback();
  }
  this.log.info(
    '%s: homekit any on changed from %s to %s', this.name, this.hk.any_on, on
  );
  this.hk.on = on;
  const newOn = this.hk.on ? true : false;
  this.request('on', newOn);
  return callback();
};

HueLight.prototype.setBri = function(bri, callback) {
  if (bri === this.hk.bri) {
    return callback();
  }
  this.log.info(
    '%s: homekit brightness changed from %s%% to %s%%', this.name,
  	this.hk.bri, bri
  );
  this.hk.bri = bri;
  const newBri = Math.round(this.hk.bri * 254 / 100);
  this.request('bri', newBri);
  return callback();
};

HueLight.prototype.setCT = function(ct, callback) {
  if (ct === this.state.ct) {
    return callback();
  }
  this.log.info(
    '%s: homekit color temperature changed from %s mired to %s mired',
    this.name, this.state.ct, ct);
  this.state.ct = ct;
  this.request('ct', ct);
  return callback();
};

HueLight.prototype.setHue = function(hue, callback) {
  if (hue === this.hk.hue) {
    return callback();
  }
  this.log.info(
    '%s: homekit hue changed from %s˚ to %s˚', this.name, this.hk.hue, hue
  );
  this.hk.hue = hue;
  if (this.config.xy) {
    const newXY = invHueSat(this.hk.hue, this.hk.sat, this.config.gamut);
    this.request('xy', [newXY[0], newXY[1]]);
  } else {
    const newHue = Math.round(this.hk.hue * 65535 / 360);
    this.request('hue', newHue);
  }
  return callback();
};

HueLight.prototype.setSat = function(sat, callback) {
  if (sat === this.hk.sat) {
    return callback();
  }
  this.log.info(
    '%s: homekit saturation changed from %s%% to %s%%', this.name,
  	this.hk.sat, sat
  );
  this.hk.sat = sat;
  if (this.config.xy) {
    const newXY = invHueSat(this.hk.hue, this.hk.sat, this.config.gamut);
    this.request('xy', [newXY[0], newXY[1]]);
  } else {
    const newSat = Math.round(this.hk.sat * 254 / 100);
    this.request('sat', newSat);
  }
  return callback();
};

// Collect changes into a combined request.
HueLight.prototype.request = function(key, value) {
  this.updating = true;
  if (this.desiredState) {
    // Add this change to pending update.
    this.desiredState[key] = value;
    return;
  }
  this.desiredState = {};
  this.desiredState[key] = value;
  if (this.bridge.platform.config.waitTimeUpdate) {
    setTimeout(function() {
      this.put();
    }.bind(this), this.bridge.platform.config.waitTimeUpdate);
  } else {
    this.put();
  }
};

// Send the request (for the combined changes) to the Hue bridge.
HueLight.prototype.put = function() {
  // jshint -W106
  const desiredState = this.desiredState;
  if (
    this.bridge.state.transitiontime !== this.bridge.defaultTransitiontime &&
    desiredState.transitiontime === undefined
  ) {
    desiredState.transitiontime = this.bridge.state.transitiontime * 10;
    this.bridge.resetTransitionTime();
  }
  this.desiredState = null;
  this.bridge.request('put', this.resourcePath, desiredState)
  .then (function(obj) {
    for (const key in desiredState) {
      if (key !== 'transitiontime') {
       this.state[key] = desiredState[key];
     }
    }
    if (this.type === 'group' && desiredState.on !== undefined) {
      this.state.any_on = desiredState.on;
      this.state.all_on = desiredState.on;
    }
    this.updating = false;
    return;
  }.bind(this))
  .catch(function(err) {
    return;
  }.bind(this));
};
