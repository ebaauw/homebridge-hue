// homebridge-hue/lib/HueLight.js
// (C) 2016-2017, Erik Baauw
//
// Homebridge plugin for Philips Hue.
//
// HueLight provides support for Philips Hue lights and groups.
//
// Todo:
// - Collect all homekit changes into one bridge update.

"use strict";

module.exports = {
  setHomebridge: setHomebridge,
  HueLight: HueLight
};

// ===== Homebridge ======================================================================

let Accessory;
let Service;
let Characteristic;

function setHomebridge(homebridge) {
  Accessory = homebridge.platformAccessory;
  Service = homebridge.hap.Service;
  Characteristic = homebridge.hap.Characteristic;
}

// Color gamuts supported by Philips Hue lamps.
// See: http://www.developers.meethue.com/documentation/supported-lights
const gamuts = {
  A: {R: {x: 0.7040, y: 0.2960}, G: {x: 0.2151, y: 0.7106}, B: {x: 0.1380, y: 0.0800}},
  B: {R: {x: 0.6750, y: 0.3220}, G: {x: 0.4090, y: 0.5180}, B: {x: 0.1670, y: 0.0400}},
  C: {R: {x: 0.6920, y: 0.3080}, G: {x: 0.1700, y: 0.7000}, B: {x: 0.1530, y: 0.0480}},
  X: {R: {x: 1.0000, y: 0.0000}, G: {x: 0.0000, y: 1.0000}, B: {x: 0.0000, y: 0.0000}},
};

// Color gamut per light model.
// See: http://www.developers.meethue.com/documentation/supported-lights
function gamut(modelid) {
  switch (modelid) {
    case "LCT001",
         "LCT007": return gamuts.B;	// Hue bulb A19
    case "LCT010",
         "LCT014": return gamuts.C;	// Hue bulb A19
    case "LCT002": return gamuts.B;	// Hue Spot BR30
    case "LCT003": return gamuts.B;	// Hue Spot GU10
    case "LCT011": return gamuts.C;	// Hue BR30
    case "LST001": return gamuts.A;	// Hue LightStrips
    case "LLC010": return gamuts.A;	// Hue Living Colors Iris
    case "LLC011",
         "LLC012": return gamuts.A;	// Hue Living Colors Bloom
    case "LLC006": return gamuts.A;	// Living Colors Gen3 Iris
    case "LLC007": return gamuts.A;	// Living Colors Gen3 Bloom, Aura
    case "LLC013": return gamuts.A;	// Disney Living Colors
    case "LLM001": return gamuts.B;	// Color Light Module
    case "LLC020": return gamuts.C;	// Hue Go
    case "LST002": return gamuts.C;	// Hue LightStrips Plus
    default:       return gamuts.X;
  }
}

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

// Return point in model's color gamut closest to p.
function closestInGamut(p, model) {
  const g = gamut(model);
  const R = g.R;
  const G = g.G;
  const B = g.B;
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
function hueSat(xy, modelid) {
  // Inverse Gamma correction (sRGB Companding).
  function compand(v) {
    return v <= 0.0031308 ? 12.92 * v : (1.0 + 0.055) * Math.pow(v, (1.0 / 2.4)) - 0.055;
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
  const p = closestInGamut({x: xy[0], y: xy[1]}, modelid);
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
function invHueSat(hue, sat, model) {
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
  const q = closestInGamut(p, model);
  return [Math.round(q.x * 10000) / 10000, Math.round(q.y * 10000) / 10000];
}

// ===== HueLight ========================================================================

function HueLight(bridge, id, obj, type) {
  this.log = bridge.log;
  this.bridge = bridge;
  this.name = obj.name;
  this.type = type || "light";
  this.url = "/" + this.type + "s/" + id;
  const zigbee = this.type === "light";
  this.uuid_base = zigbee ? obj.uniqueid.split("-")[0] : bridge.uuid_base + this.url;
  if (obj.manufacturername === "dresden elektronik") {
    // Include extension for Dresden Elektronik lights, as the Hue bridge treats these
    // as multiple lights with the same Zigbee ID.
    this.uuid_base = obj.uniqueid;
  }
  this.key = this.type === "group" ? "action" : "state";
  this.url += "/" + this.key;
  if (obj.manufacturername === "OSRAM") {
    this.maxCT = 370;
  } else if (obj.manufacturername === "Philips" && obj.type === "Color temperature light") {
    this.maxCT =  454;
  } else {
    this.maxCT =  500;
  }
  this.obj = obj;
  this.refresh();

  this.infoService = new Service.AccessoryInformation();
  this.infoService
    .setCharacteristic(Characteristic.Manufacturer, zigbee ? obj.manufacturername : "homebridge-hue")
    .setCharacteristic(Characteristic.Model, zigbee ? obj.modelid : obj.type)
    .setCharacteristic(Characteristic.SerialNumber, this.uuid_base);
   if (this.state.bri === undefined  && this.state.ct === undefined && this.state.xy === undefined) {
     this.service = new Service.Switch(this.name);
   } else {
    this.service = new Service.Lightbulb(this.name);
  }
  this.service.setCharacteristic(Characteristic.On, this.hk.on);
  this.service.getCharacteristic(Characteristic.On)
    .on("get", function(callback) {callback(null, this.hk.on);}.bind(this))
    .on("set", this.setOn.bind(this));
  if (this.state.bri !== undefined) {
    this.service.setCharacteristic(Characteristic.Brightness, this.hk.bri);
    this.service.getCharacteristic(Characteristic.Brightness)
      .on("get", function(callback) {callback(null, this.hk.bri);}.bind(this))
      .on("set", this.setBri.bind(this));
  }
  if (this.state.ct !== undefined) {
    this.service.addOptionalCharacteristic(Characteristic.ColorTemperature);
    this.service.getCharacteristic(Characteristic.ColorTemperature)
      .setProps({minValue: this.colorTemperature(this.maxCT)});
    this.service.setCharacteristic(Characteristic.ColorTemperature, this.hk.ct);
    this.service.getCharacteristic(Characteristic.ColorTemperature)
     .on("get", function(callback) {callback(null, this.hk.ct);}.bind(this))
     .on("set", this.setColorTemperature.bind(this));
    if (this.bridge.platform.config.ct) {
      this.service.addOptionalCharacteristic(Characteristic.CT);
      this.service.getCharacteristic(Characteristic.CT)
        .setProps({maxValue: this.maxCT});
      this.service.setCharacteristic(Characteristic.CT, this.state.ct);
      this.service.getCharacteristic(Characteristic.CT)
        .on("get", function(callback) {callback(null, this.state.ct);}.bind(this))
        .on("set", this.setCT.bind(this));
    }
  }
  if (this.state.xy !== undefined) {
    this.service.setCharacteristic(Characteristic.Hue, this.hk.hue);
    this.service.setCharacteristic(Characteristic.Saturation, this.hk.sat);
    this.service.getCharacteristic(Characteristic.Hue)
      .on("get", function(callback) {callback(null, this.hk.hue);}.bind(this))
      .on("set", this.setHue.bind(this));
    this.service.getCharacteristic(Characteristic.Saturation)
      .on("get", function(callback) {callback(null, this.hk.sat);}.bind(this))
      .on("set", this.setSat.bind(this));
  }
  if (this.state.reachable !== undefined) {
    this.service.addOptionalCharacteristic(Characteristic.StatusFault);
    this.service.setCharacteristic(Characteristic.StatusFault, this.hk.fault);
    this.service.getCharacteristic(Characteristic.StatusFault)
      .on("get", function(callback) {callback(null, this.hk.fault);}.bind(this));
  }
  if (zigbee) {
    this.service.addOptionalCharacteristic(Characteristic.UniqueID);
    this.service.setCharacteristic(Characteristic.UniqueID, this.obj.uniqueid);
    this.service.getCharacteristic(Characteristic.UniqueID)
      .on("get", function(callback) {callback(null, this.obj.uniqueid);}.bind(this));
  }
}

HueLight.prototype.getServices = function() {
  return [this.service, this.infoService];
};

HueLight.prototype.refresh = function() {
  this.state = this.obj[this.key];
  this.hk = {};
  this.hk.on = this.state.on ? 1 : 0;
  if (this.state.bri !== undefined) {
    this.hk.bri = Math.round(this.state.bri * 100.0 / 254.0);
  }
  if (this.state.ct !== undefined) {
    this.hk.ct = this.colorTemperature(this.state.ct);
  }
  if (this.state.xy !== undefined) {
    const hs = hueSat(this.state.xy, this.obj.modelid);
    this.hk.hue = hs.hue;
    this.hk.sat = hs.sat;
  }
  if (this.state.reachable !== undefined) {
    this.hk.fault = this.state.reachable ? 0 : 1;
  }
};

HueLight.prototype.colorTemperature = function(ct) {
  return Math.round(1000000.0 / ct);
};

HueLight.prototype.invColorTemperature = function(kelvin) {
  return Math.max(153, Math.min(Math.round(1000000.0 / kelvin), this.maxCT));
};

// ===== Bridge Events ===================================================================

HueLight.prototype.heartbeat = function(obj) {
  const old = {
    obj: this.obj,
    state: this.state,
    hk: this.hk
  };
  this.obj = obj;
  this.refresh();
  if (this.state.on !== old.state.on) {
    this.log.debug("%s: %s power changed from %s to %s", this.name, this.type,
    		   old.state.on, this.state.on);
  }
  if (this.hk.on !== old.hk.on) {
    this.log.info("%s: set homekit power from %s to %s", this.name,
    		  old.hk.on, this.hk.on);
    this.service.setCharacteristic(Characteristic.On, this.hk.on);
  }
  if (this.state.bri !== undefined && this.state.bri !== old.state.bri) {
    this.log.debug("%s: %s bri changed from %s to %s", this.name, this.type,
    		   old.state.bri, this.state.bri);
  }
  if (this.hk.bri !== old.hk.bri) {
    this.log.info("%s: set homekit brightness from %s%% to %s%%", this.name,
    		  old.hk.bri, this.hk.bri);
    this.service.setCharacteristic(Characteristic.Brightness, this.hk.bri);
  }
  if (this.state.ct !== undefined && this.state.ct !== old.state.ct) {
    if (this.state.colormode === "ct") {
      this.log.debug("%s: %s ct changed from %s to %s", this.name, this.type,
      		     old.state.ct, this.state.ct);
    } else {
      this.log.debug("%s: %s ct updated by %s from %s to %s", this.name, this.type,
      		     this.state.colormode, old.state.ct, this.state.ct);
    }
    this.service.setCharacteristic(Characteristic.CT, this.state.ct);
  }
  if (this.hk.ct !== old.hk.ct) {
    this.log.info("%s: set homekit color temperature from %sK to %sK",
      		  this.name, old.hk.ct, this.hk.ct);
    this.service.setCharacteristic(Characteristic.ColorTemperature, this.hk.ct);
  }
  if (this.state.hue !== undefined && this.state.hue !== old.state.hue) {
    if (this.state.colormode === "hs") {
      this.log.debug("%s: %s hue changed from %s to %s", this.name, this.type,
        	     old.state.hue, this.state.hue);
    } else {
      this.log.debug("%s: %s hue changed by %s from %s to %s", this.name, this.type,
        	     this.state.colormode, old.state.hue, this.state.hue);
    }
  }
  if (this.state.sat !== undefined && this.state.sat !== old.state.sat) {
    if (this.state.colormode === "hs") {
      this.log.debug("%s: %s sat changed from %s to %s", this.name, this.type,
		     old.state.sat, this.state.sat);
    } else {
      this.log.debug("%s: %s sat changed by %s from %s to %s", this.name, this.type,
		     this.state.colormode, old.state.sat, this.state.sat);
    }
  }
  if (this.state.xy !== undefined &&
      (this.state.xy[0] != old.state.xy[0] || this.state.xy[1] != old.state.xy[1])) {
    if (this.state.colormode === "xy") {
      this.log.debug("%s: %s xy changed from %j to %j", this.name, this.type,
      		     old.state.xy, this.state.xy);
    } else {
      this.log.debug("%s: %s xy changed by %s from %j to %j", this.name, this.type,
      		     this.state.colormode, old.state.xy, this.state.xy);
    }
  }
  if (this.hk.hue !== old.hk.hue) {
    this.log.info("%s: set homekit hue from %s˚ to %s˚",
		  this.name, old.hk.hue, this.hk.hue);
    this.service.setCharacteristic(Characteristic.Hue, this.hk.hue);
  }
  if (this.hk.hue !== old.hk.hue) {
    this.log.info("%s: set homekit saturation from %s%% to %s%%",
		  this.name, old.hk.sat, this.hk.sat);
    this.service.setCharacteristic(Characteristic.Saturation, this.hk.sat);
  }
  if (this.state.reachable !== undefined && this.state.reachable !== old.state.reachable) {
    this.log.debug("%s: %s reachable changed from %s to %s", this.name, this.type,
           old.state.reachable, this.state.reachable);
  }
  if (this.hk.fault !== old.hk.fault) {
    this.log.info("%s: set homekit status fault from %s to %s",
		  this.name, old.hk.fault, this.hk.fault);
    this.service.setCharacteristic(Characteristic.StatusFault, this.hk.fault);

  }
};

// ===== Homekit Events ==================================================================

HueLight.prototype.identify = function(callback) {
  this.log.info("%s: identify", this.name);
  this.bridge.request("put", this.url, {alert: "select"})
  .then(function(obj) {
    return callback();
  }.bind(this))
  .catch(function(err) {
    return callback(new Error(err));
  }.bind(this));
};

// TODO: collect all changes into one bridge update.

HueLight.prototype.setOn = function(on, callback) {
  if (on === this.hk.on) {
    // light updated from hue bridge - we're good
    return callback();
  }
  this.log.info("%s: homekit power changed from %s to %s", this.name, this.hk.on, on);
  this.hk.on = on;
  const newOn = this.hk.on ? true : false;
  this.bridge.request("put", this.url, {on: newOn})
  .then(function(obj) {
    this.state.on = newOn;
    return callback();
  }.bind(this))
  .catch(function(err) {
    return callback(new Error(err));
  }.bind(this));
};

HueLight.prototype.setBri = function(bri, callback) {
  if (bri === this.hk.bri) {
    // light updated from hue bridge - we're good
    return callback();
  }
  this.log.info("%s: homekit brightness changed from %s%% to %s%%", this.name,
  		this.hk.bri, bri);
  this.hk.bri = bri;
  const newBri = Math.round(this.hk.bri * 254 / 100);
  this.bridge.request("put", this.url, {bri: newBri})
  .then(function(obj) {
    this.state.bri = newBri;
    return callback();
  }.bind(this))
  .catch(function(err) {
    return callback(new Error(err));
  }.bind(this));
};

HueLight.prototype.setColorTemperature = function(ct, callback) {
  if (ct === this.hk.ct) {
    // light updated from hue bridge - we're good
    return callback();
  }
  this.log.info("%s: homekit color temperature changed from %sK to %sK", this.name,
  		this.hk.ct, ct);
  this.hk.ct = ct;
  const newCT = this.invColorTemperature(this.hk.ct);
  this.bridge.request("put", this.url, {ct: newCT})
  .then(function(obj) {
    this.state.ct = newCT;
    if (this.bridge.platform.config.ct) {
      this.service.setCharacteristic(Characteristic.CT, this.state.ct);
    }
    return callback();
  }.bind(this))
  .catch(function(err) {
    return callback(new Error(err));
  }.bind(this));
};

HueLight.prototype.setCT = function(ct, callback) {
  if (ct === this.state.ct) {
    // light updated from hue bridge - we're good
    return callback();
  }
  this.log.info("%s: homekit color temperature changed from %s to %s", this.name,
  		this.state.ct, ct);
  this.bridge.request("put", this.url, {ct: ct})
  .then(function(obj) {
    this.state.ct = ct;
    this.hk.ct = this.colorTemperature(this.state.ct);
    this.service.setCharacteristic(Characteristic.ColorTemperature, this.hk.ct);
    return callback();
  }.bind(this))
  .catch(function(err) {
    return callback(new Error(err));
  }.bind(this));
};

HueLight.prototype.setHue = function(hue, callback) {
  if (hue === this.hk.hue) {
    // light updated from hue bridge - we're good
    return callback();
  }
  this.log.info("%s: homekit hue changed from %s˚ to %s˚", this.name, this.hk.hue, hue);
  this.hk.hue = hue;
  const newXY = invHueSat(this.hk.hue, this.hk.sat, this.obj.modelid);
  this.bridge.request("put", this.url, {xy: [newXY[0], newXY[1]]})
  .then(function(obj) {
    this.state.xy = newXY;
    return callback();
  }.bind(this))
  .catch(function(err) {
    return callback(new Error(err));
  }.bind(this));
};

HueLight.prototype.setSat = function(sat, callback) {
  if (sat === this.hk.sat) {
    // light updated from hue bridge - we're good
    return callback();
  }
  this.log.info("%s: homekit saturation changed from %s%% to %s%%", this.name,
  	        this.hk.sat, sat);
  this.hk.sat = sat;
  const newXY = invHueSat(this.hk.hue, this.hk.sat, this.obj.modelid);
  this.bridge.request("put", this.url, {xy: [newXY[0], newXY[1]]})
  .then(function(obj) {
    this.state.xy = newXY;
    return callback();
  }.bind(this))
  .catch(function(err) {
    return callback(new Error(err));
  }.bind(this));
};
