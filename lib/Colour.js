// homebridge-hue/lib/Colour.js
// Copyright © 2016-2020 Erik Baauw. All rights reserved.
//
// Homebridge plugin for Philips Hue and/or deCONZ.

'use strict'

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
function xyToHueSaturation (xy, gamut) {
  // Inverse Gamma correction (sRGB Companding).
  function compand (v) {
    return v <= 0.0031308
      ? 12.92 * v
      : (1.0 + 0.055) * Math.pow(v, (1.0 / 2.4)) - 0.055
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
function hueSaturationToXy (hue, sat, gamut) {
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

// ct to xy
// From deCONZ REST API plugin.
// Results don't match xy values as retuned by Hue LCT015 exactly, but seem
// to be close enough.
function ctToXy (ct) {
  const kelvin = 1000000 / ct
  let x, y

  if (kelvin < 4000) {
    x = 11790 +
        57520658 / kelvin +
        -15358885888 / kelvin / kelvin +
        -17440695910400 / kelvin / kelvin / kelvin
  } else {
    x = 15754 +
        14590587 / kelvin +
        138086835814 / kelvin / kelvin +
        -198301902438400 / kelvin / kelvin / kelvin
  }
  if (kelvin < 2222) {
    y = -3312 +
        35808 * x / 0x10000 +
        -22087 * x * x / 0x100000000 +
        -18126 * x * x * x / 0x1000000000000
  } else if (kelvin < 4000) {
    y = -2744 +
        34265 * x / 0x10000 +
        -22514 * x * x / 0x100000000 +
        -15645 * x * x * x / 0x1000000000000
  } else {
    y = -6062 +
        61458 * x / 0x10000 +
        -96229 * x * x / 0x100000000 +
        50491 * x * x * x / 0x1000000000000
  }
  y *= 4
  x /= 0xFFFF
  y /= 0xFFFF

  return [Math.round(x * 10000) / 10000, Math.round(y * 10000) / 10000]
}

module.exports = {
  xyToHueSaturation: xyToHueSaturation,
  hueSaturationToXy: hueSaturationToXy,
  ctToXy: ctToXy
}
