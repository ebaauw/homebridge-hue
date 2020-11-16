// homebridge-hue/lib/AdaptiveLighting.js
// Copyright © 2020 Erik Baauw. All rights reserved.
//
// Homebridge plugin for Philips Hue and/or deCONZ.

'use strict'

/* global BigInt */

const epoch = (new Date('2001-01-01T00:00:00Z')).valueOf()

// Types in TLV values for Adaptive Lighting.
const types = {
  1: { key: 'configuration', type: 'tlv' },
  1.1: { key: 'iid', type: 'uint' },
  1.2: { key: 'characteristic', type: 'uint' },
  2: { key: 'control', type: 'tlv' },
  2.1: { key: 'colorTemperature', type: 'tlv' },
  '2.1.1': { key: 'iid', type: 'uint' },
  '2.1.2': { key: 'transitionParameters', type: 'tlv' },
  '2.1.2.1': { type: 'hex' },
  '2.1.2.2': { key: 'startTime', type: 'date' },
  '2.1.2.3': { type: 'hex' },
  '2.1.3': { key: 'runtime', type: 'uint' },
  '2.1.5': { key: 'curve', type: 'tlv' },
  '2.1.5.1': { key: 'entries', type: 'tlv' },
  '2.1.5.1.1': { key: 'adjustmentFactor', type: 'float' },
  '2.1.5.1.2': { key: 'value', type: 'float' },
  '2.1.5.1.3': { key: 'offset', type: 'uint' },
  '2.1.5.1.4': { key: 'duration', type: 'uint' },
  '2.1.5.2': { key: 'adjustmentIid', type: 'uint' },
  '2.1.5.3': { key: 'adjustmentRange', type: 'tlv' },
  '2.1.5.3.1': { key: 'min', type: 'uint' },
  '2.1.5.3.2': { key: 'max', type: 'uint' },
  '2.1.6': { key: 'updateInterval', type: 'uint' },
  '2.1.8': { key: 'notifyIntervalThreshold', type: 'uint' }
}

// Recursively parse TLV value.
function parseTlv (path, buf) {
  path = path == null ? '' : path + '.'
  const result = {}
  for (let i = 0; i < buf.length;) {
    let type = buf[i++]
    let length = buf[i++]
    let value = buf.slice(i, i + length)
    i += length
    while (length === 255 && i < buf.length) {
      if (buf[i] === type) {
        i++
        length = buf[i++]
        value = Buffer.concat([value, buf.slice(i, i + length)])
        i += length
      }
    }
    type = path + type
    // console.error('type: %s, length: %d, value: %j', type, length, value)

    let key = type
    if (types[type] != null) {
      if (types[type].key != null) {
        key = types[type].key
      }
      switch (types[type].type) {
        case 'uint':
          if (length === 1) {
            value = value.readUInt8()
          } else if (length === 2) {
            value = value.readUint16LE()
          } else if (length === 4) {
            value = value.readUint32LE()
          } else if (length === 8) {
            value = Number(value.readBigUInt64LE())
          }
          break
        case 'float':
          if (length === 4) {
            value = value.readFloatLE()
          }
          break
        case 'date':
          if (length === 8) {
            value = new Date(Number(value.readBigUInt64LE()) + epoch).toISOString()
          }
          break
        case 'hex':
          value = value.toString('hex').toUpperCase()
          break
        case 'tlv':
          value = parseTlv(type, value)
          break
        default:
          break
      }
    } else if (length === 0) {
      // ignore empty value
      key = null
      value = null
    }

    if (key != null) {
      // Add key/value-pair to result.
      if (result[key] == null) {
        // New key: add key/value-pair.
        result[key] = value
      } else {
        // Duplicate key.
        if (!Array.isArray(result[key])) {
          // Turn value into array.
          result[key] = [result[key]]
        }
        // Add new value to value array.
        result[key].push(value)
      }
    }
  }
  return result
}

function tlvBuffer (type, length) {
  const buf = Buffer.alloc(2 + length)
  buf[0] = type
  buf[1] = length
  return buf
}

function tlvFromNull (type) {
  return tlvBuffer(type, 0)
}

function tlvFromBuffer (type, value) {
  const buf = tlvBuffer(type, value.length)
  value.copy(buf, 2, 0)
  return buf
}

// function tlvFromUInt8 (type, value) {
//   const buf = tlvBuffer(type, 1)
//   buf.writeUInt8(value, 2)
//   return buf
// }

// function tlvFromUInt16 (type, value) {
//   const buf = tlvBuffer(type, 2)
//   buf.writeUint16LE(value, 2)
//   return buf
// }

function tlvFromUInt32 (type, value) {
  const buf = tlvBuffer(type, 4)
  buf.writeUint32LE(value, 2)
  return buf
}

function tlvFromBigUInt64 (type, value) {
  const buf = tlvBuffer(type, 8)
  buf.writeBigUInt64LE(BigInt(value), 2)
  return buf
}

function tlvFromHexString (type, value) {
  return tlvFromBuffer(type, Buffer.from(value, 'hex'))
}

// function tlvFromFloat (type, value) {
//   const buf = tlvBuffer(type, 4)
//   buf.writeFloatLE(value, 2)
//   return buf
// }

class AdaptiveLighting {
  constructor (bri, ct) {
    this.bri = bri
    this.ct = ct
    this._active = false
  }

  get active () { return this._active }

  deactivate () {
    this._active = false
  }

  generateConfiguration () {
    return Buffer.concat([
      tlvFromBuffer(1, Buffer.concat([
        tlvFromBigUInt64(1, this.bri),
        tlvFromUInt32(2, 1)
      ])),
      tlvFromNull(0),
      tlvFromBuffer(1, Buffer.concat([
        tlvFromBigUInt64(1, this.ct),
        tlvFromUInt32(2, 2)
      ]))
    ]).toString('base64')
  }

  generateControlResponse () {
    if (!this._active) {
      return ''
    }
    return tlvFromBuffer(2, tlvFromBuffer(1, Buffer.concat([
      tlvFromBigUInt64(1, this.ct),
      tlvFromBuffer(2, Buffer.concat([
        tlvFromHexString(1, this._p1),
        tlvFromBigUInt64(2, this._startTime - epoch),
        tlvFromHexString(3, this._p3)
      ])),
      tlvFromBigUInt64(3, Math.max(1, (new Date()).valueOf() - this._startTime))
    ]))).toString('base64')
  }

  generateControl () {
    if (!this._active) {
      return ''
    }
    return tlvFromBuffer(1, Buffer.concat([
      tlvFromBigUInt64(1, this.ct),
      tlvFromBuffer(2, Buffer.concat([
        tlvFromHexString(1, this._p1),
        tlvFromBigUInt64(2, this._startTime - epoch),
        tlvFromHexString(3, this._p3)
      ])),
      tlvFromBigUInt64(3, Math.max(1, (new Date()).valueOf() - this._startTime))
    ])).toString('base64')
  }

  parseConfiguration (value) {
    return parseTlv(null, Buffer.from(value, 'base64'))
  }

  parseControlWrite (value) {
    const control = parseTlv(null, Buffer.from(value, 'base64'))

    if (control.control.colorTemperature.iid !== this.ct) {
      throw new Error(
        '%d: bad ColorTemperature iid', control.control.colorTemperature.iid
      )
    }
    if (control.control.colorTemperature.curve.adjustmentIid !== this.bri) {
      throw new Error(
        '%d: bad Brightness iid',
        control.control.colorTemperature.curve.adjustmentIid
      )
    }
    this._active = true
    this._p1 = control.control.colorTemperature.transitionParameters['2.1.2.1']
    this._startTime = (new Date(
      control.control.colorTemperature.transitionParameters.startTime
    )).valueOf()
    this._p3 = control.control.colorTemperature.transitionParameters['2.1.2.3']
    return control
  }

  parseControlResponse (value) {
    return parseTlv(null, Buffer.from(value, 'base64'))
  }

  parseControl (value) {
    return parseTlv('2', Buffer.from(value, 'base64'))
  }
}

module.exports = AdaptiveLighting
