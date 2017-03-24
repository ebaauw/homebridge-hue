// homebridge-hue/lib/HueLight.js
// (C) 2016-2017, Erik Baauw
//
// Homebridge plugin for Philips Hue.
//
// HueLight provides support for Philips Hue lights and groups.

'use strict';

module.exports = {
  setHomebridge: setHomebridge,
  HueLight: HueLight
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

  const R = gamut.R;
  const G = gamut.G;
  const B = gamut.B;
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
    .updateCharacteristic(Characteristic.SerialNumber, this.config.serialNumber);
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
    if (this.bridge.platform.config.ct) {
      this.service.addOptionalCharacteristic(Characteristic.CT);
      this.service.getCharacteristic(Characteristic.CT)
        .updateValue(this.state.ct)
        .on('set', this.setCT.bind(this))
        .setProps({maxValue: this.config.maxCT});
    } else {
      this.service.addOptionalCharacteristic(Characteristic.ColorTemperature);
      this.service.getCharacteristic(Characteristic.ColorTemperature)
        .updateValue(this.hk.ct)
        .on('set', this.setColorTemperature.bind(this))
        .setProps({minValue: this.colorTemperature(this.config.maxCT)});
    }
  }
  if (this.config.xy) {
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
    if (!this.bridge.platform.config.philipsLights) {
      this.service.addOptionalCharacteristic(Characteristic.UniqueID);
      this.service.getCharacteristic(Characteristic.UniqueID)
        .updateValue(this.obj.uniqueid);
    }
  }
  this.service.addOptionalCharacteristic(Characteristic.Resource);
  this.service.getCharacteristic(Characteristic.Resource)
    .updateValue(this.resource);
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
    ct: this.state.ct !== undefined,
    xy: this.state.xy !== undefined
  };
  if (this.config.ct) {
    // Default colour temperature range: 153 (~6500K) - 500 (2000K).
    this.config.maxCT = 500;
  }
  if (this.config.xy) {
    this.config.gamut = { // Default colour gamut.
      R: {x: 1.0000, y: 0.0000},
      G: {x: 0.0000, y: 1.0000},
      B: {x: 0.0000, y: 0.0000}
    };
  }
  if (this.type === 'group') {
    this.config.manufacturer = 'Philips';
    this.config.model = this.obj.type;
    this.config.serialNumber = this.bridge.uuid_base + this.resource;
    return;
  }
  this.config.manufacturer = this.obj.manufacturername;
  this.config.model = this.obj.modelid;
  this.config.serialNumber = this.obj.uniqueid.split('-')[0];

  switch (this.config.manufacturer) {
    case 'Philips':
      // Color gamut per light model.
      // See: http://www.developers.meethue.com/documentation/supported-lights
      switch (this.config.model) {
        case 'LST001':                  // Hue LightStrips
        case 'LLC010':                  // Hue Living Colors Iris
        case 'LLC011':                  // Hue Living Colors Bloom
        case 'LLC012':
        case 'LLC006':                  // Living Colors Gen3 Iris
        case 'LLC007':                  // Living Colors Gen3 Bloom, Aura
        case 'LLC013':                  // Disney Living Colors
          this.config.gamut = {         // Gamut A
            R: {x: 0.7040, y: 0.2960},
            G: {x: 0.2151, y: 0.7106},
            B: {x: 0.1380, y: 0.0800}
          };
          return;
        case 'LCT001':                  // Hue bulb A19
        case 'LCT007':                  // Hue bulb A19
        case 'LCT002':                  // Hue Spot BR30
        case 'LCT003':                  // Hue Spot GU10
        case 'LLM001':                  // Color Light Module
          this.config.gamut = {         // Gamut B
            R: {x: 0.6750, y: 0.3220},
            G: {x: 0.4090, y: 0.5180},
            B: {x: 0.1670, y: 0.0400}
          };
          return;
        case 'LCT010':                  // Hue bulb A19
        case 'LCT014':                  // Hue bulb A19
        case 'LCT011':                  // Hue BR30
        case 'LLC020':                  // Hue Go
        case 'LST002':                  // Hue LightStrips Plus
        case 'LCT012':                  // Hue Color Candle
          this.config.gamut = {         // Gamut C
            R: {x: 0.6920, y: 0.3080},
            G: {x: 0.1700, y: 0.7000},
            B: {x: 0.1530, y: 0.0480}
          };
          return;
        case 'LTW001':                  // Hue A19 White Ambiance
        case 'LTW004':                  // Hue A19 White Ambiance
        case 'LTW013':                  // Hue GU-10 White Ambiance
        case 'LTW014':                  // Hue GU-10 White Ambiance
        case 'LTW012':                  // Hue Ambiance Candle
        case 'LLM010':                  // Color Temperature Module
        case 'LLM011':                  // Color Temperature Module
        case 'LLM012':                  // Color Temperature Module
          this.config.maxCT =  454;
          return;
        case 'LWL001':                  // Dimmable plug-in unit
        case 'LWB004':                  // Hue A19 lux
        case 'LWB006':                  // Hue A19 lux
        case 'LWB007':                  // Hue A19 lux
        case 'LWB010':                  // Hue A19 lux
        case 'LWB014':                  // Hue A19 lux
          return;
        default:
          break;
      }
      break;
    case 'OSRAM':
      switch (this.config.model) {
        case 'Plug - LIGHTIFY':
        case 'Plug 01':
          return;
        case 'PAR16 50 TW':
        case 'Classic B40 TW - LIGHTIFY':
          this.config.maxCT = 370;
          if (this.obj.swversion === 'V1.03.07') {
            this.config.noTransitionTime = true;
          }
          return;
        default:
          break;
      }
      break;
    case 'innr':
      // See: https://shop.innrlighting.com/en/shop
      switch (this.config.model) {
        case 'FL 110':                  // Flex Light
        case 'PL 110':                  // Puck Light
        case 'ST 110':                  // Strip
        case 'UC 110':                  // Under Cabinet
        case 'SL 110':                  // Spot
        case 'DL 110':                  // Spot
          this.config.noAlert = true;
          return;
        case 'RB 162':                  // Bulb
        case 'RS 125':                  // GU-10
          return;
        default:
          break;
        }
      break;
    case 'dresden elektronik':
      switch (this.config.model) {
        case 'FLS-PP3':                 // FLS-PP lp
        case 'FLS-PP3 White':
          this.config.subtype = this.obj.uniqueid.split('-')[1];
          return;
        default:
          break;
      }
      break;
    case 'Busch-Jaeger':
      // See: https://www.busch-jaeger.de/en/products/product-solutions/dimmer/busch-radio-controlled-dimmer-zigbee-light-link/
      switch (this.config.model) {
        case 'RM01':                    // 6715 U-500 with 6736-84
          return;
        default:
          break;
      }
      break;
    case 'GE_Appliances':
      switch (this.config.model) {
        case 'ZLL Light':
          return;
        default:
          break;
      }
      break;
    case 'CREE ':
      switch (this.config.model) {
        case 'Connected A-19 60W Equivalent ':
          return;
        default:
          break;
      }
      break;
    default:
      break;
  }
  this.log.error(
    '%s: %s: warning: unknown light model %j',
    this.bridge.name, this.resource, this.obj
  );
};

HueLight.prototype.colorTemperature = function(ct) {
  return Math.round(1000000.0 / ct);
};

HueLight.prototype.invColorTemperature = function(kelvin) {
  return Math.max(
    153, Math.min(Math.round(1000000.0 / kelvin), this.config.maxCT)
  );
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
    this.hk.on = this.state.reachable && this.state.on ? 1 : 0;
    this.hk.fault = this.state.reachable ? 0 : 1;
  }
  if (this.config.bri) {
    this.hk.bri = Math.round(this.state.bri * 100.0 / 254.0);
  }
  if (this.config.ct) {
    this.hk.ct = this.colorTemperature(this.state.ct);
  }
  if (this.config.xy) {
    const hs = hueSat(this.state.xy, this.config.gamut);
    this.hk.hue = hs.hue;
    this.hk.sat = hs.sat;
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
  if (this.hk.on !== old.hk.on) {
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
  if (this.state.ct !== old.state.ct) {
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
    if (this.bridge.platform.config.ct) {
      this.log.info(
        '%s: set homekit color temperature from %s mired to %s mired',
        this.name, old.state.ct, this.state.ct
      );
      this.service.getCharacteristic(Characteristic.CT)
        .updateValue(this.state.ct);
    }
  }
  if (!this.bridge.platform.config.ct && this.hk.ct !== old.hk.ct) {
    this.log.info(
      '%s: set homekit color temperature from %sK to %sK',
      this.name, old.hk.ct, this.hk.ct
    );
    this.service.getCharacteristic(Characteristic.ColorTemperature)
      .updateValue(this.hk.ct);
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
  if (on === this.hk.on) {
    return callback();
  }
  this.log.info(
    '%s: homekit power changed from %s to %s', this.name, this.hk.on, on
  );
  this.hk.on = on;
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

HueLight.prototype.setColorTemperature = function(ct, callback) {
  if (ct === this.hk.ct) {
    return callback();
  }
  this.log.info(
    '%s: homekit color temperature changed from %sK to %sK', this.name,
  	this.hk.ct, ct
  );
  this.hk.ct = ct;
  const newCT = this.invColorTemperature(this.hk.ct);
  this.request('ct', newCT);
  return callback();
};

HueLight.prototype.setCT = function(ct, callback) {
  if (ct === this.state.ct) {
    return callback();
  }
  this.log.info(
    '%s: homekit color temperature changed from %s mired to %s mired',
    this.name, this.state.ct, ct);
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
  const newXY = invHueSat(this.hk.hue, this.hk.sat, this.config.gamut);
  this.request('xy', [newXY[0], newXY[1]]);
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
  const newXY = invHueSat(this.hk.hue, this.hk.sat, this.config.gamut);
  this.request('xy', [newXY[0], newXY[1]]);
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
  this.desiredState = null;
  this.bridge.request('put', this.resourcePath, desiredState)
  .then (function(obj) {
    for (const key in desiredState) {
      this.state[key] = desiredState[key];
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
