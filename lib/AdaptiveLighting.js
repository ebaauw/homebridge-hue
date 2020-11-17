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
  '2.1.5.1.2': { key: 'mired', type: 'float' },
  '2.1.5.1.3': { key: 'offset', type: 'uint' },
  '2.1.5.1.4': { key: 'duration', type: 'uint' },
  '2.1.5.2': { key: 'adjustmentIid', type: 'uint' },
  '2.1.5.3': { key: 'adjustmentRange', type: 'tlv' },
  '2.1.5.3.1': { key: 'min', type: 'uint' },
  '2.1.5.3.2': { key: 'max', type: 'uint' },
  '2.1.6': { key: 'updateInterval', type: 'uint' },
  '2.1.8': { key: 'notifyIntervalThreshold', type: 'uint' }
}

// Recursively parse TLV value into an object.
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

// Return a TLV buffer for given type and length, with empty value.
function tlvBuffer (type, length) {
  const buf = Buffer.alloc(2 + length)
  buf[0] = type
  buf[1] = length
  return buf
}

// Return a TLV buffer for given type with length 0.
function tlvFromNull (type) {
  return tlvBuffer(type, 0)
}

// Return a TLV buffer for given type and buffer value.
function tlvFromBuffer (type, value) {
  const buf = tlvBuffer(type, value.length)
  value.copy(buf, 2, 0)
  return buf
}

// Return a TLV buffer for given type and uint value.
function tlvFromUInt (type, value) {
  const buf = Buffer.alloc(8)
  buf.writeBigUInt64LE(BigInt(value))
  let length
  if (value > 0xFFFFFFFF) {
    length = 8
  } else if (value > 0xFFFF) {
    length = 4
  } else if (value > 0xFF) {
    length = 2
  } else {
    length = 1
  }
  return tlvFromBuffer(type, buf.slice(0, length))
}

// Return a TVL buffer for given type and hex string value.
function tlvFromHexString (type, value) {
  return tlvFromBuffer(type, Buffer.from(value, 'hex'))
}

class AdaptiveLighting {
  constructor (bri, ct) {
    this.bri = bri
    this.ct = ct
    this._active = false
  }

  get active () { return this._control != null }

  deactivate () {
    delete this._control
  }

  generateConfiguration () {
    return Buffer.concat([
      tlvFromBuffer(1, Buffer.concat([
        tlvFromUInt(1, this.bri),
        tlvFromUInt(2, 1)
      ])),
      tlvFromNull(0),
      tlvFromBuffer(1, Buffer.concat([
        tlvFromUInt(1, this.ct),
        tlvFromUInt(2, 2)
      ]))
    ]).toString('base64')
  }

  _generateControl () {
    return tlvFromBuffer(1, Buffer.concat([
      tlvFromUInt(1, this.ct),
      tlvFromBuffer(2, Buffer.concat([
        tlvFromHexString(1, this._control.transitionParameters['2.1.2.1']),
        tlvFromUInt(2, this._startTime - epoch),
        tlvFromHexString(3, this._control.transitionParameters['2.1.2.3'])
      ])),
      tlvFromUInt(3, Math.max(1, (new Date()).valueOf() - this._startTime))
    ]))
  }

  generateControlResponse () {
    if (this._control == null) {
      return ''
    }
    return tlvFromBuffer(2, this._generateControl()).toString('base64')
  }

  generateControl () {
    if (this._control == null) {
      return ''
    }
    return this._generateControl().toString('base64')
  }

  parseConfiguration (value) {
    return parseTlv(null, Buffer.from(value, 'base64'))
  }

  parseControlWrite (value) {
    value = parseTlv(null, Buffer.from(value, 'base64'))
    const control = value.control.colorTemperature

    if (control.iid !== this.ct) {
      throw new Error('%d: bad ColorTemperature iid', control.iid)
    }
    if (control.curve.adjustmentIid !== this.bri) {
      throw new Error('%d: bad Brightness iid', control.curve.adjustmentIid)
    }
    this._control = control
    this._startTime = (new Date(control.transitionParameters.startTime)).valueOf()
    return value
  }

  parseControlResponse (value) {
    return parseTlv(null, Buffer.from(value, 'base64'))
  }

  parseControl (value) {
    return parseTlv('2', Buffer.from(value, 'base64'))
  }

  getCt (bri, offset) {
    if (this._control == null) {
      return null
    }
    if (offset == null) {
      offset = (new Date()).valueOf() - this._startTime
    }
    offset %= 86400000
    bri = Math.max(this._control.curve.adjustmentRange.min, bri)
    bri = Math.min(bri, this._control.curve.adjustmentRange.max)
    for (let i = 1; i < this._control.curve.entries.length; i++) {
      const entry = this._control.curve.entries[i]
      const targetCt = Math.round(entry.mired + entry.adjustmentFactor * bri)
      if (offset < entry.offset) {
        const pEntry = this._control.curve.entries[i - 1]
        const ratio = offset / entry.offset
        const mired = (1 - ratio) * pEntry.mired + ratio * entry.mired
        const adjustmentFactor = (1 - ratio) * pEntry.adjustmentFactor +
                                 ratio * entry.adjustmentFactor
        return {
          ct: Math.round(mired + adjustmentFactor * bri),
          targetCt: targetCt,
          interval: entry.offset - offset
        }
      }
      offset -= entry.offset
      if (entry.duration != null) {
        if (offset < entry.duration) {
          return {
            ct: targetCt,
            targetCt: targetCt,
            interval: entry.duration - offset
          }
        }
        offset -= entry.duration
      }
    }
  }
}

module.exports = AdaptiveLighting
