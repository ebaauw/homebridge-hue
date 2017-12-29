const gamuts = {
  default: {
    r: [1, 0],
    g: [0, 1],
    b: [0, 0]
  },
  PhilipsA: {    // Color Lights
    r: [0.7040, 0.2960],
    g: [0.2151, 0.7106],
    b: [0.1380, 0.0800]
  },
  PhilipsB: {    // Extended Color Lights
    r: [0.6750, 0.3220],
    g: [0.4090, 0.5180],
    b: [0.1670, 0.0400]
  },
  PhilipsC: {    // next gen Extended Color Lights
    r: [0.6920, 0.3080],
    g: [0.1700, 0.7000],
    b: [0.1530, 0.0480]
  },
  innr: {
    "r": [0.8817, 0.1033],
    "g": [0.2204, 0.7758],
    "b": [0.0551, 0.1940]
  }
};

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

// HSV to RGB
// See: https://en.wikipedia.org/wiki/HSL_and_HSV
function HStoRGB(hue, sat, bri = 100) {
  let H = hue / 360.0;
  const S = sat / 100.0;
  const V = bri / 100.0;
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
  return {r: R, g: G, b: B};
}

// Transform homekit hue value [0˚, 360˚] and saturation value [0%, 100%]
// to bridge xy values [0.0, 1.0].
function invHueSat(hue, sat, gamut) {
  // Gamma correction (inverse sRGB Companding).
  function invCompand(v) {
    return v > 0.04045 ? Math.pow((v + 0.055) / (1.0 + 0.055), 2.4) : v / 12.92;
  }

  const RGB = HStoRGB(hue, sat);

  // RGB to XYZ to xyY
  // See: http://www.developers.meethue.com/documentation/color-conversions-rgb-xy
  const linearR = invCompand(RGB.R);
  const linearG = invCompand(RGB.G);
  const linearB = invCompand(RGB.B);
  const X = linearR * 0.664511 + linearG * 0.154324 + linearB * 0.162028;
  const Y = linearR * 0.283881 + linearG * 0.668433 + linearB * 0.047685;
  const Z = linearR * 0.000088 + linearG * 0.072310 + linearB * 0.986039;
  const sum = X + Y + Z;
  const p = sum === 0.0 ? {x: 0.0, y: 0.0} : {x: X / sum, y: Y / sum};
  const q = closestInGamut(p, gamut);
  return [Math.round(q.x * 10000) / 10000, Math.round(q.y * 10000) / 10000];
}

// const colours = {
//   r: [1, 0],
//   g: [0, 1],
//   b: [0, 0]
// };
//
// // Test closestInGamut
// for (const gamutId in gamuts) {
//   const gamut = gamuts[gamutId];
//   console.log(gamutId);
//   for (const colourId in colours) {
//     const colour = colours[colourId];
//     const p = closestInGamut({x: colour[0], y: colour[1]}, gamut);
//     const xy = [Math.round(p.x * 10000) / 10000, Math.round(p.y * 10000) / 10000];
//     console.log(colourId, xy, gamut[colourId]);
//   }
// }

const hsColours = {
  r: {hue:   0, sat: 100},
  g: {hue: 120, sat: 100},
  b: {hue: 240, sat: 100}
};

// Test HStoRGB
for (const hsColourId in hsColours) {
  const hsColour = hsColours[hsColourId];
  console.log(hsColourId, hsColour, HStoRGB(hsColour.hue, hsColour.sat, 50));
}
