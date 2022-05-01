// homebridge-hue/lib/HueSensor.js
// Copyright © 2016-2022 Erik Baauw. All rights reserved.
//
// Homebridge plugin for Philips Hue and/or deCONZ.

'use strict'

// Link this module to HuePlatform.
module.exports = {
  setHomebridge: setHomebridge,
  HueSensor: HueSensor
}

function toInt (value, minValue, maxValue) {
  const n = parseInt(value)
  if (isNaN(n) || n < minValue) {
    return minValue
  }
  if (n > maxValue) {
    return maxValue
  }
  return n
}

function dateToString (date, utc = true) {
  if (date == null || date === 'none') {
    return 'n/a'
  }
  if (utc && !date.endsWith('Z')) {
    date += 'Z'
  }
  return String(new Date(date)).slice(0, 24)
}

const daylightEvents = {
  100: { name: 'Solar Midnight', period: 'Night' },
  110: { name: 'Astronomical Dawn', period: 'Astronomical Twilight' },
  120: { name: 'Nautical Dawn', period: 'Nautical Twilight' },
  130: { name: 'Dawn', period: 'Twilight' },
  140: { name: 'Sunrise', period: 'Sunrise' },
  150: { name: 'End Sunrise', period: 'Golden Hour' },
  160: { name: 'End Golden Hour', period: 'Day' },
  170: { name: 'Solar Noon', period: 'Day' },
  180: { name: 'Start Golden Hour', period: 'Golden Hour' },
  190: { name: 'Start Sunset', period: 'Sunset' },
  200: { name: 'Sunset', period: 'Twilight' },
  210: { name: 'Dusk', period: 'Nautical Twilight' },
  220: { name: 'Nautical Dusk', period: 'Astronomical Twilight' },
  230: { name: 'Astronomical Dusk', period: 'Night' }
}

const daylightPeriods = {
  Night: { lightlevel: 0, daylight: false, dark: true },
  'Astronomical Twilight': { lightlevel: 100, daylight: false, dark: true },
  'Nautical Twilight': { lightlevel: 1000, daylight: false, dark: true },
  Twilight: { lightlevel: 10000, daylight: false, dark: false },
  Sunrise: { lightlevel: 15000, daylight: true, dark: false },
  Sunset: { lightlevel: 20000, daylight: true, dark: false },
  'Golden Hour': { lightlevel: 40000, daylight: true, dark: false },
  Day: { lightlevel: 65535, daylight: true, dark: false }
}

// ===== Homebridge ============================================================

// Link this module to homebridge.
let Service
let Characteristic
let my
let eve
// let HistoryService

let SINGLE
let SINGLE_DOUBLE
let SINGLE_LONG
let SINGLE_DOUBLE_LONG
// let DOUBLE
// let DOUBLE_LONG
let LONG

let airQualityValues

function setHomebridge (homebridge, _my, _eve) {
  Service = homebridge.hap.Service
  Characteristic = homebridge.hap.Characteristic
  my = _my
  eve = _eve
  SINGLE = {
    minValue: Characteristic.ProgrammableSwitchEvent.SINGLE_PRESS,
    maxValue: Characteristic.ProgrammableSwitchEvent.SINGLE_PRESS,
    validValues: [
      Characteristic.ProgrammableSwitchEvent.SINGLE_PRESS
    ]
  }
  SINGLE_DOUBLE = {
    minValue: Characteristic.ProgrammableSwitchEvent.SINGLE_PRESS,
    maxValue: Characteristic.ProgrammableSwitchEvent.DOUBLE_PRESS,
    validValues: [
      Characteristic.ProgrammableSwitchEvent.SINGLE_PRESS,
      Characteristic.ProgrammableSwitchEvent.DOUBLE_PRESS
    ]
  }
  SINGLE_LONG = {
    minValue: Characteristic.ProgrammableSwitchEvent.SINGLE_PRESS,
    maxValue: Characteristic.ProgrammableSwitchEvent.LONG_PRESS,
    validValues: [
      Characteristic.ProgrammableSwitchEvent.SINGLE_PRESS,
      Characteristic.ProgrammableSwitchEvent.LONG_PRESS
    ]
  }
  SINGLE_DOUBLE_LONG = {
    minValue: Characteristic.ProgrammableSwitchEvent.SINGLE_PRESS,
    maxValue: Characteristic.ProgrammableSwitchEvent.LONG_PRESS,
    validValues: [
      Characteristic.ProgrammableSwitchEvent.SINGLE_PRESS,
      Characteristic.ProgrammableSwitchEvent.DOUBLE_PRESS,
      Characteristic.ProgrammableSwitchEvent.LONG_PRESS
    ]
  }
  // DOUBLE = {
  //   minValue: Characteristic.ProgrammableSwitchEvent.DOUBLE_PRESS,
  //   maxValue: Characteristic.ProgrammableSwitchEvent.DOUBLE_PRESS,
  //   validValues: [
  //     Characteristic.ProgrammableSwitchEvent.DOUBLE_PRESS
  //   ]
  // }
  // DOUBLE_LONG = {
  //   minValue: Characteristic.ProgrammableSwitchEvent.DOUBLE_PRESS,
  //   maxValue: Characteristic.ProgrammableSwitchEvent.LONG_PRESS,
  //   validValues: [
  //     Characteristic.ProgrammableSwitchEvent.DOUBLE_PRESS,
  //     Characteristic.ProgrammableSwitchEvent.LONG_PRESS
  //   ]
  // }
  LONG = {
    minValue: Characteristic.ProgrammableSwitchEvent.LONG_PRESS,
    maxValue: Characteristic.ProgrammableSwitchEvent.LONG_PRESS,
    validValues: [
      Characteristic.ProgrammableSwitchEvent.LONG_PRESS
    ]
  }

  airQualityValues = {
    excellent: Characteristic.AirQuality.EXCELLENT,
    good: Characteristic.AirQuality.GOOD,
    moderate: Characteristic.AirQuality.FAIR,
    poor: Characteristic.AirQuality.INFERIOR,
    unhealthy: Characteristic.AirQuality.POOR
  }
}

function hkLightLevel (v) {
  let l = v ? Math.pow(10, (v - 1) / 10000) : 0.0001
  l = Math.round(l * 10000) / 10000
  return l > 100000 ? 100000 : l < 0.0001 ? 0.0001 : l
}

const PRESS = 0
const HOLD = 1
const SHORT_RELEASE = 2
const LONG_RELEASE = 3
const DOUBLE_PRESS = 4
const TRIPLE_PRESS = 5
const QUADRUPLE_PRESS = 6
const SHAKE = 7
const DROP = 8
// const TILT = 9

// As homebridge-hue polls the Hue bridge, not all dimmer switch buttonevents
// are received reliably.  Consequently, we only issue one HomeKit change per
// Press/Hold/Release event series.
function hkZLLSwitchAction (value, oldValue, repeat = false) {
  if (value < 1000) {
    return Characteristic.ProgrammableSwitchEvent.SINGLE_PRESS
  }
  const button = Math.floor(value / 1000)
  const oldButton = Math.floor(oldValue / 1000)
  const event = value % 1000
  const oldEvent = oldValue % 1000
  switch (event) {
    case PRESS:
      // Wait for Hold or Release after press.
      return null
    case SHORT_RELEASE:
      return Characteristic.ProgrammableSwitchEvent.SINGLE_PRESS
    case HOLD:
    case LONG_RELEASE:
      if (repeat) {
        return Characteristic.ProgrammableSwitchEvent.SINGLE_PRESS
      }
      if (button === oldButton && oldEvent === HOLD) {
        // Already issued action on previous Hold.
        return null
      }
      // falls through
    case TRIPLE_PRESS:
    case QUADRUPLE_PRESS:
    case SHAKE:
      return Characteristic.ProgrammableSwitchEvent.LONG_PRESS
    case DOUBLE_PRESS:
    case DROP:
      return Characteristic.ProgrammableSwitchEvent.DOUBLE_PRESS
    default:
      return null
  }
}

// ===== HueSensor =============================================================

function HueSensor (accessory, id, obj) {
  this.accessory = accessory
  this.id = id
  this.obj = obj
  this.bridge = this.accessory.bridge
  this.log = this.accessory.log
  this.serialNumber = this.accessory.serialNumber
  this.name = this.obj.name
  this.hk = {}
  this.resource = '/sensors/' + id
  this.serviceList = []

  if (this.obj.type[0] === 'Z') {
    // Zigbee sensor.
    this.manufacturer = this.obj.manufacturername
    this.model = this.obj.modelid
    this.endpoint = this.obj.uniqueid.split('-')[1]
    this.cluster = this.obj.uniqueid.split('-')[2]
    this.subtype = this.endpoint + '-' + this.cluster
    this.version = this.obj.swversion
  } else {
    // Hue bridge internal sensor.
    this.manufacturer = this.bridge.manufacturer
    if (this.accessory.isMulti) {
      this.model = 'MultiCLIP'
      this.subtype = this.id
    } else if (
      this.obj.manufacturername === 'homebridge-hue' &&
      this.obj.modelid === this.obj.type &&
      this.obj.uniqueid.split('-')[1] === this.id
    ) {
      // Combine multiple CLIP sensors into one accessory.
      this.model = 'MultiCLIP'
      this.subtype = this.id
    } else {
      this.model = this.obj.type
    }
    this.version = this.bridge.version
  }
  this.infoService = this.accessory.getInfoService(this)

  let durationKey = 'duration'
  let temperatureHistory = 'weather'
  let heatValue = 'auto'
  switch (this.obj.type) {
    case 'ZGPSwitch':
    case 'ZLLSwitch':
    case 'ZHASwitch': {
      this.buttonMap = {}
      let namespace = Characteristic.ServiceLabelNamespace.ARABIC_NUMERALS
      let homekitValue = (v) => { return Math.floor(v / 1000) }
      let homekitAction = hkZLLSwitchAction

      switch (this.obj.manufacturername) {
        case 'Bitron Home':
          switch (this.obj.modelid) {
            case '902010/23': // Bitron remote, see #639.
              namespace = Characteristic.ServiceLabelNamespace.DOTS
              this.createButton(1, 'DimUp', SINGLE)
              this.createButton(2, 'On', SINGLE)
              this.createButton(3, 'Off', SINGLE)
              this.createButton(4, 'DimDown', SINGLE)
              break
            default:
              break
          }
          break
        case 'Busch-Jaeger':
          switch (this.obj.modelid) {
            case 'RM01': // Busch-Jaeger Light Link control element (mains-powered)
            case 'RB01': // Busch-Jaeger Light Link wall-mounted transmitter
              if (this.endpoint === '0a') {
                this.createButton(1, 'Button 1', SINGLE_LONG)
                this.createButton(2, 'Button 2', SINGLE_LONG)
              } else if (this.endpoint === '0b') {
                this.createButton(3, 'Button 3', SINGLE_LONG)
                this.createButton(4, 'Button 4', SINGLE_LONG)
              } else if (this.endpoint === '0c') {
                this.createButton(5, 'Button 5', SINGLE_LONG)
                this.createButton(6, 'Button 6', SINGLE_LONG)
              } else if (this.endpoint === '0d') {
                this.createButton(7, 'Button 7', SINGLE_LONG)
                this.createButton(8, 'Button 8', SINGLE_LONG)
              }
              break
            default:
              break
          }
          break
        case 'Echostar':
          switch (this.obj.modelid) {
            case 'Bell':
              this.createButton(1, 'Front Doorbell', SINGLE)
              this.createButton(2, 'Rear Doorbell', SINGLE)
              break
            default:
              break
          }
          break
        case 'ELKO':
          switch (this.obj.modelid) {
            case 'ElkoDimmerRemoteZHA': // ELKO ESH 316 Endevender RF, see #922.
              this.createButton(1, 'Press', SINGLE)
              this.createButton(2, 'Dim Up', SINGLE)
              this.createButton(3, 'Dim Down', SINGLE)
              break
            default:
              break
          }
          break
        case 'Heiman':
          switch (this.obj.modelid) {
            case 'RC-EF-3.0':
              namespace = Characteristic.ServiceLabelNamespace.DOTS
              this.createButton(1, 'HomeMode', SINGLE)
              this.createButton(2, 'Disarm', SINGLE)
              this.createButton(3, 'SOS', SINGLE)
              this.createButton(4, 'Arm', SINGLE)
              break
            default:
              break
          }
          break
        case 'IKEA of Sweden':
          switch (this.obj.modelid) {
            case 'Remote Control N2':
              this.createButton(1, 'DimUp', SINGLE_LONG)
              this.createButton(2, 'DimDown', SINGLE_LONG)
              this.createButton(3, 'Previous', SINGLE_LONG)
              this.createButton(4, 'Next', SINGLE_LONG)
              break
            case 'SYMFONISK Sound Controller':
              this.createButton(1, 'Button', SINGLE_DOUBLE_LONG)
              if (this.obj.mode === 1) {
                this.createButton(2, 'Turn Right', LONG)
                this.createButton(3, 'Turn Left', LONG)
              } else {
                this.createButton(2, 'Turn Right', SINGLE)
                this.createButton(3, 'Turn Left', SINGLE)
              }
              break
            case 'TRADFRI SHORTCUT Button':
              this.createButton(1, 'Button', SINGLE_LONG)
              break
            case 'TRADFRI on/off switch':
              this.createButton(1, 'On', SINGLE_LONG)
              this.createButton(2, 'Off', SINGLE_LONG)
              break
            case 'TRADFRI open/close remote':
              this.createButton(1, 'Open', SINGLE_LONG)
              this.createButton(2, 'Close', SINGLE_LONG)
              break
            case 'TRADFRI remote control':
              this.createButton(1, 'On/Off', SINGLE)
              this.createButton(2, 'Dim Up', SINGLE_LONG)
              this.createButton(3, 'Dim Down', SINGLE_LONG)
              this.createButton(4, 'Previous', SINGLE_LONG)
              this.createButton(5, 'Next', SINGLE_LONG)
              break
            case 'TRADFRI wireless dimmer':
              if (this.obj.mode === 1) {
                this.createButton(1, 'Turn Right', SINGLE_LONG)
                this.createButton(2, 'Turn Left', SINGLE_LONG)
              } else {
                this.createButton(1, 'On', SINGLE)
                this.createButton(2, 'Dim Up', SINGLE)
                this.createButton(3, 'Dim Down', SINGLE)
                this.createButton(4, 'Off', SINGLE)
              }
              break
            default:
              break
          }
          break
        case 'Insta':
          switch (this.obj.modelid) {
            case 'HS_4f_GJ_1': // Gira/Jung Light Link hand transmitter
            case 'WS_3f_G_1': // Gira Light Link wall transmitter
            case 'WS_4f_J_1': // Jung Light Link wall transmitter
              this.createButton(1, 'Off', SINGLE_DOUBLE_LONG)
              this.createButton(2, 'On', SINGLE_DOUBLE_LONG)
              this.createButton(3, 'Scene 1', SINGLE)
              this.createButton(4, 'Scene 2', SINGLE)
              this.createButton(5, 'Scene 3', SINGLE)
              this.createButton(6, 'Scene 4', SINGLE)
              if (this.obj.modelid !== 'WS_3f_G_1') {
                this.createButton(7, 'Scene 5', SINGLE)
                this.createButton(8, 'Scene 6', SINGLE)
              }
              break
            default:
              break
          }
          break
        case 'LDS':
          switch (this.obj.modelid) {
            case 'ZBT-DIMController-D0800':
              this.createButton(1, 'On/Off', SINGLE)
              this.createButton(2, 'DimUp', SINGLE_LONG)
              this.createButton(3, 'DimDown', SINGLE_LONG)
              this.createButton(4, 'Scene', SINGLE_LONG)
              break
            default:
              break
          }
          break
        case 'LIDL Livarno Lux':
          switch (this.obj.modelid) {
            case 'HG06323':
              this.createButton(1, 'On', SINGLE_DOUBLE_LONG)
              this.createButton(2, 'DimUp', SINGLE_LONG)
              this.createButton(3, 'DimDown', SINGLE_LONG)
              this.createButton(4, 'Off', SINGLE)
              break
            default:
              break
          }
          break
        case 'LUMI':
          switch (this.obj.modelid) {
            case 'lumi.remote.b1acn01':
            case 'lumi.remote.b186acn01':
            case 'lumi.remote.b186acn02':
              this.createButton(1, 'Left', SINGLE_DOUBLE_LONG)
              break
            case 'lumi.remote.b28ac1':
            case 'lumi.remote.b286acn01':
            case 'lumi.remote.b286acn02':
              this.createButton(1, 'Left', SINGLE_DOUBLE_LONG)
              this.createButton(2, 'Right', SINGLE_DOUBLE_LONG)
              this.createButton(3, 'Both', SINGLE_DOUBLE_LONG)
              break
            case 'lumi.remote.b286opcn01': // Xiaomi Aqara Opple, see #637.
            case 'lumi.remote.b486opcn01': // Xiaomi Aqara Opple, see #637.
            case 'lumi.remote.b686opcn01': // Xiaomi Aqara Opple, see #637.
              this.createButton(1, '1', SINGLE_DOUBLE_LONG)
              this.createButton(2, '2', SINGLE_DOUBLE_LONG)
              if (this.obj.modelid !== 'lumi.remote.b286opcn01') {
                this.createButton(3, '3', SINGLE_DOUBLE_LONG)
                this.createButton(4, '4', SINGLE_DOUBLE_LONG)
                if (this.obj.modelid === 'lumi.remote.b686opcn01') {
                  this.createButton(5, '5', SINGLE_DOUBLE_LONG)
                  this.createButton(6, '6', SINGLE_DOUBLE_LONG)
                }
              }
              break
            case 'lumi.sensor_86sw1': // Xiaomi wall switch (single button)
              this.createButton(1, 'Button', SINGLE_DOUBLE)
              break
            case 'lumi.sensor_86sw2': // Xiaomi wall switch (two buttons)
            case 'lumi.ctrl_ln2.aq1':
              this.createButton(1, 'Left', SINGLE_DOUBLE)
              this.createButton(2, 'Right', SINGLE_DOUBLE)
              this.createButton(3, 'Both', SINGLE_DOUBLE)
              break
            case 'lumi.sensor_cube':
            case 'lumi.sensor_cube.aqgl01':
              if (this.endpoint === '02') {
                this.createButton(1, 'Side 1', SINGLE_DOUBLE_LONG)
                this.createButton(2, 'Side 2', SINGLE_DOUBLE_LONG)
                this.createButton(3, 'Side 3', SINGLE_DOUBLE_LONG)
                this.createButton(4, 'Side 4', SINGLE_DOUBLE_LONG)
                this.createButton(5, 'Side 5', SINGLE_DOUBLE_LONG)
                this.createButton(6, 'Side 6', SINGLE_DOUBLE_LONG)
                this.createButton(7, 'Cube', SINGLE_DOUBLE_LONG)
                homekitAction = (v) => {
                  if (v === 7000) { // Wakeup
                    return Characteristic.ProgrammableSwitchEvent.SINGLE_PRESS
                  } else if (v === 7007) { // Shake
                    return Characteristic.ProgrammableSwitchEvent.LONG_PRESS
                  } else if (v === 7008) { // Drop
                    return Characteristic.ProgrammableSwitchEvent.DOUBLE_PRESS
                  } else if (v % 1000 === 0) { // Push
                    return Characteristic.ProgrammableSwitchEvent.LONG_PRESS
                  } else if (v % 1000 === Math.floor(v / 1000)) { // Double tap
                    return Characteristic.ProgrammableSwitchEvent.DOUBLE_PRESS
                  } else { // Flip
                    return Characteristic.ProgrammableSwitchEvent.SINGLE_PRESS
                  }
                }
              } else if (this.endpoint === '03') {
                this.createButton(8, 'Turn Right', SINGLE_DOUBLE_LONG)
                this.createButton(9, 'Turn Left', SINGLE_DOUBLE_LONG)
                homekitValue = (v) => { return v > 0 ? 8 : 9 }
                homekitAction = (v) => {
                  return Math.abs(v) < 4500
                    ? Characteristic.ProgrammableSwitchEvent.SINGLE_PRESS
                    : Math.abs(v) < 9000
                      ? Characteristic.ProgrammableSwitchEvent.DOUBLE_PRESS
                      : Characteristic.ProgrammableSwitchEvent.LONG_PRESS
                }
              }
              break
            case 'lumi.sensor_switch': // Xiaomi Mi wireless switch
            case 'lumi.sensor_switch.aq2': // Xiaomi Aqara smart wireless switch
            case 'lumi.sensor_switch.aq3': // Xiaomi Aqara smart wireless switch with gyro
              this.createButton(1, 'Button', SINGLE_DOUBLE_LONG)
              break
            default:
              break
          }
          break
        case 'Lutron':
          switch (this.obj.modelid) {
            case 'LZL4BWHL01 Remote': // Lutron Pico, see 102.
              this.createButton(1, 'On', SINGLE)
              this.createButton(2, 'DimUp', LONG)
              this.createButton(3, 'DimDown', LONG)
              this.createButton(4, 'Off', SINGLE)
              break
            case 'Z3-1BRL': // Lutron Aurora, see #522.
              if (this.bridge.isHue) {
                this.createButton(1, 'Button', SINGLE_LONG)
              } else {
                this.createButton(1, 'Button', SINGLE)
                this.createButton(2, 'Turn Right', SINGLE)
                this.createButton(3, 'Turn Left', SINGLE)
              }
              break
            default:
              break
          }
          break
        case 'MLI':
          switch (this.obj.modelid) {
            case 'ZBT-Remote-ALL-RGBW': // Tint remote control by Müller-Licht see deconz-rest-plugin#1209
              this.createButton(1, 'On/Off', SINGLE)
              this.createButton(2, 'DimUp', SINGLE_LONG)
              this.createButton(3, 'DimDown', SINGLE_LONG)
              this.createButton(4, 'Warm', SINGLE)
              this.createButton(5, 'Cool', SINGLE)
              this.createButton(6, 'Colour Wheel', SINGLE)
              this.createButton(7, 'Work Light', SINGLE)
              this.createButton(8, 'Sunset', SINGLE)
              this.createButton(9, 'Party', SINGLE)
              this.createButton(10, 'Night Light', SINGLE)
              this.createButton(11, 'Campfire', SINGLE)
              this.createButton(12, 'Romance', SINGLE)
              break
            default:
              break
          }
          break
        case 'OSRAM':
          switch (this.obj.modelid) {
            case 'Lightify Switch Mini':
              this.createButton(1, 'Up', SINGLE_LONG)
              this.createButton(2, 'Down', SINGLE_LONG)
              this.createButton(3, 'Middle', SINGLE_LONG)
              break
            default:
              break
          }
          break
        case 'Philips':
        case 'Signify Netherlands B.V.': {
          const repeat = this.bridge.platform.config.hueDimmerRepeat
          const events = repeat ? SINGLE : SINGLE_LONG
          switch (this.obj.modelid) {
            case 'RDM001': // Hue wall switch module
              switch (obj.config.devicemode) {
                case 'singlerocker':
                  this.createButton(1, 'Rocker 1', SINGLE)
                  break
                case 'singlepushbutton':
                  this.createButton(1, 'Push Button 1', events)
                  if (repeat) this.repeat = [1]
                  break
                case 'dualrocker':
                  this.createButton(1, 'Rocker 1', SINGLE)
                  this.createButton(2, 'Rocker 2', SINGLE)
                  break
                case 'dualpushbutton':
                  this.createButton(1, 'Push Button 1', events)
                  this.createButton(2, 'Push Button 2', events)
                  if (repeat) this.repeat = [1, 2]
                  break
                default:
                  break
              }
              break
            case 'ROM001': // Hue smart button
              this.createButton(1, 'Button', events)
              if (repeat) this.repeat = [1]
              break
            case 'RWL020':
            case 'RWL021': // Hue dimmer switch
              this.createButton(1, 'On', SINGLE_LONG)
              this.createButton(2, 'Dim Up', events)
              this.createButton(3, 'Dim Down', events)
              this.createButton(4, 'Off', SINGLE_LONG)
              if (repeat) this.repeat = [2, 3]
              break
            case 'RWL022': // Hue dimmer switch (2021)
              this.createButton(1, 'On', SINGLE_LONG) // On/Off
              this.createButton(2, 'Dim Up', events)
              this.createButton(3, 'Dim Down', events)
              this.createButton(4, 'Off', SINGLE_LONG) // Hue
              if (repeat) this.repeat = [2, 3]
              break
            case 'ZGPSWITCH': // Hue tap
              namespace = Characteristic.ServiceLabelNamespace.DOTS
              this.createButton(1, '1', SINGLE)
              this.createButton(2, '2', SINGLE)
              this.createButton(3, '3', SINGLE)
              this.createButton(4, '4', SINGLE)
              this.createButton(5, '1 and 2', SINGLE)
              this.createButton(6, '3 and 4', SINGLE)
              homekitValue = (v) => {
                if (v < 1000) {
                  return { 34: 1, 16: 2, 17: 3, 18: 4, 101: 5, 99: 6 }[v]
                }
                return Math.floor(v / 1000)
              }
              homekitAction = () => {
                return Characteristic.ProgrammableSwitchEvent.SINGLE_PRESS
              }
              break
            default:
              break
          }
          break
        }
        case 'PhilipsFoH':
          switch (this.obj.modelid) {
            case 'FOHSWITCH': { // Friends-of-Hue switch
              const events = this.bridge.isDeconz ? SINGLE_LONG : SINGLE
              this.createButton(1, 'Top Left', events)
              this.createButton(2, 'Bottom Left', events)
              this.createButton(3, 'Top Right', events)
              this.createButton(4, 'Bottom Right', events)
              this.createButton(5, 'Top Both', events)
              this.createButton(6, 'Bottom Both', events)
              homekitValue = (value) => {
                if (value < 1000) {
                  return { 20: 1, 21: 2, 23: 3, 22: 4, 101: 5, 99: 6 }[value]
                }
                return Math.floor(value / 1000)
              }
              break
            }
            default:
              break
          }
          break
        case 'Samjin':
          switch (this.obj.modelid) {
            case 'button':
              this.createButton(1, 'Button', SINGLE_DOUBLE_LONG)
              break
            default:
              break
          }
          break
        case 'Sunricher':
          switch (this.obj.modelid) {
            case 'ZG2833K8_EU05': // Sunricher 8-button remote, see #529.
              if (this.endpoint === '01') {
                this.createButton(1, 'On 1', SINGLE_LONG)
                this.createButton(2, 'Off 1', SINGLE_LONG)
              } else if (this.endpoint === '02') {
                this.createButton(3, 'On 2', SINGLE_LONG)
                this.createButton(4, 'Off 2', SINGLE_LONG)
              } else if (this.endpoint === '03') {
                this.createButton(5, 'On 3', SINGLE_LONG)
                this.createButton(6, 'Off 3', SINGLE_LONG)
              } else if (this.endpoint === '04') {
                this.createButton(7, 'On 4', SINGLE_LONG)
                this.createButton(8, 'Off 4', SINGLE_LONG)
              }
              break
            case 'ZG2833PAC': // Sunricher C4
              this.createButton(1, 'Rocker 1', SINGLE)
              this.createButton(2, 'Rocker 2', SINGLE)
              this.createButton(3, 'Rocker 3', SINGLE)
              this.createButton(4, 'Rocker 4', SINGLE)
              break
            case 'ZGRC-KEY-002': // Sunricher CCT remote, see #529.
              this.createButton(1, 'On', SINGLE)
              this.createButton(2, 'Off', SINGLE)
              this.createButton(3, 'Dim', LONG)
              this.createButton(4, 'C/W', SINGLE_LONG)
              break
            default:
              break
          }
          break
        case '_TZ3000_arfwfgoa':
          switch (this.obj.modelid) {
            case 'TS0042': // Tuys 2-button switch, single endpoint
              this.createButton(1, 'Left', SINGLE_DOUBLE_LONG)
              this.createButton(2, 'Right', SINGLE_DOUBLE_LONG)
              break
            default:
              break
          }
          break
        case '_TZ3000_dfgbtub0':
        case '_TZ3000_i3rjdrwu':
          switch (this.obj.modelid) {
            case 'TS0042': // Tuya 2-button switch, see #1060.
              if (this.endpoint === '01') {
                this.createButton(1, 'Button 1', SINGLE_DOUBLE_LONG)
              } else if (this.endpoint === '02') {
                this.createButton(2, 'Button 2', SINGLE_DOUBLE_LONG)
              }
              break
            default:
              break
          }
          break
        case '_TZ3000_pzui3skt':
          switch (this.obj.modelid) {
            case 'TS0041': // Tuya 1-button switch
              this.createButton(1, 'Button', SINGLE_DOUBLE_LONG)
              break
            default:
              break
          }
          break
        case '_TZ3000_rrjr1q0u':
          switch (this.obj.modelid) {
            case 'TS0043': // Tuya 3-button switch
              this.createButton(1, 'Left', SINGLE_DOUBLE_LONG)
              this.createButton(2, 'Middle', SINGLE_DOUBLE_LONG)
              this.createButton(3, 'Right', SINGLE_DOUBLE_LONG)
              break
            default:
              break
          }
          break
        case '_TZ3000_vp6clf9d':
          switch (this.obj.modelid) {
            case 'TS0044':
              this.createButton(1, 'Bottom Left', SINGLE_DOUBLE_LONG)
              this.createButton(2, 'Bottom Right', SINGLE_DOUBLE_LONG)
              this.createButton(3, 'Top Right', SINGLE_DOUBLE_LONG)
              this.createButton(4, 'Top Left', SINGLE_DOUBLE_LONG)
              break
            default:
              break
          }
          break
        case '_TZ3000_xabckq1v':
          switch (this.obj.modelid) {
            case 'TS004F': // Tuya 4-button switch, single press only
              this.createButton(1, 'Top Left', SINGLE)
              this.createButton(2, 'Bottom Left', SINGLE)
              this.createButton(3, 'Top Right', SINGLE)
              this.createButton(4, 'Bottom Right', SINGLE)
              break
            default:
              break
          }
          break
        case 'dresden elektronik':
          switch (this.obj.modelid) {
            case 'Kobold':
              this.createButton(1, 'Button', SINGLE_LONG)
              break
            case 'Lighting Switch':
              if (this.endpoint === '01') {
                if (this.obj.mode !== 2) {
                  this.log.warn(
                    '%s: %s: warning: Lighting Switch mode %d instead of 2',
                    this.bridge.name, this.resource, this.obj.mode
                  )
                }
                this.createButton(1, 'Top Left', SINGLE_LONG)
                this.createButton(2, 'Bottom Left', SINGLE_LONG)
                this.createButton(3, 'Top Right', SINGLE_LONG)
                this.createButton(4, 'Bottom Right', SINGLE_LONG)
              }
              break
            case 'Scene Switch':
              this.createButton(1, 'On', SINGLE_LONG)
              this.createButton(2, 'Off', SINGLE_LONG)
              this.createButton(3, 'Scene 1', SINGLE)
              this.createButton(4, 'Scene 2', SINGLE)
              this.createButton(5, 'Scene 3', SINGLE)
              this.createButton(6, 'Scene 4', SINGLE)
              break
            default:
              break
          }
          break
        case 'eWeLink':
          switch (this.obj.modelid) {
            case 'WB01':
              this.createButton(1, 'Press', SINGLE_DOUBLE_LONG)
              break
            default:
              break
          }
          break
        case 'icasa':
          switch (this.obj.modelid) {
            case 'ICZB-KPD12':
            case 'ICZB-KPD14S':
            case 'ICZB-KPD18S':
              this.createButton(1, 'Off', SINGLE_LONG)
              this.createButton(2, 'On', SINGLE_LONG)
              if (this.obj.modelid !== 'ICZB-KPD12') {
                this.createButton(3, 'S1', SINGLE)
                this.createButton(4, 'S2', SINGLE)
                if (this.obj.modelid === 'ICZB-KPD18S') {
                  this.createButton(5, 'S3', SINGLE)
                  this.createButton(6, 'S4', SINGLE)
                  this.createButton(7, 'S5', SINGLE)
                  this.createButton(8, 'S6', SINGLE)
                }
              }
              break
            case 'ICZB-RM11S':
              this.createButton(1, '1 Off', SINGLE_LONG)
              this.createButton(2, '1 On', SINGLE_LONG)
              this.createButton(3, '2 Off', SINGLE_LONG)
              this.createButton(4, '2 On', SINGLE_LONG)
              this.createButton(5, '3 Off', SINGLE_LONG)
              this.createButton(6, '3 On', SINGLE_LONG)
              this.createButton(7, '4 Off', SINGLE_LONG)
              this.createButton(8, '4 On', SINGLE_LONG)
              this.createButton(9, 'S1', SINGLE)
              this.createButton(10, 'S2', SINGLE)
              break
            default:
              break
          }
          break
        case 'innr':
          switch (this.obj.modelid) {
            case 'RC 110':
              if (this.endpoint === '01') {
                this.createButton(1, 'On/Off', SINGLE)
                this.createButton(2, 'Dim Up', SINGLE_LONG)
                this.createButton(3, 'Dim Down', SINGLE_LONG)
                this.createButton(4, '1', SINGLE)
                this.createButton(5, '2', SINGLE)
                this.createButton(6, '3', SINGLE)
                this.createButton(7, '4', SINGLE)
                this.createButton(8, '5', SINGLE)
                this.createButton(9, '6', SINGLE)
                for (let i = 1; i <= 6; i++) {
                  const button = 7 + i * 3
                  this.createButton(button, `On/Off ${i}`, SINGLE)
                  this.createButton(button + 1, `Dim Up ${i}`, SINGLE_LONG)
                  this.createButton(button + 2, `Dim Down ${i}`, SINGLE_LONG)
                }
              }
              break
            default:
              break
          }
          break
        case 'lk':
          switch (this.obj.modelid) {
            case 'ZBT-DIMSwitch-D0001': // Linkind 1-Key Remote Control, see #949.
              this.createButton(1, 'Button', SINGLE_LONG)
              homekitValue = (v) => { return 1 }
              break
            default:
              break
          }
          break
        case 'ubisys':
          switch (this.obj.modelid) {
            case 'C4 (5504)':
            case 'C4-R (5604)':
              this.createButton(1, '1', SINGLE_LONG)
              this.createButton(2, '2', SINGLE_LONG)
              this.createButton(3, '3', SINGLE_LONG)
              this.createButton(4, '4', SINGLE_LONG)
              break
            case 'D1 (5503)':
            case 'D1-R (5603)':
            case 'S1-R (5601)':
            case 'S2 (5502)':
            case 'S2-R (5602)':
              this.createButton(1, '1', SINGLE_LONG)
              this.createButton(2, '2', SINGLE_LONG)
              break
            case 'S1 (5501)':
              this.createButton(1, '1', SINGLE_LONG)
              break
            default:
              break
          }
          break
        default:
          break
      }
      if (Object.keys(this.buttonMap).length > 0) {
        this.createLabel(namespace)
        this.type = {
          key: 'buttonevent',
          homekitValue: homekitValue,
          homekitAction: homekitAction
        }
      } else {
        this.log.warn(
          '%s: %s: warning: ignoring unknown %s sensor %j',
          this.bridge.name, this.resource, this.obj.type, this.obj
        )
      }
      break
    }
    case 'ZLLRelativeRotary':
      // Lutron Aurora, see #522.
      if (
        this.obj.manufacturername === 'Lutron' &&
        this.obj.modelid === 'Z3-1BRL'
      ) {
        this.buttonMap = {}
        this.createLabel(Characteristic.ServiceLabelNamespace.ARABIC_NUMERALS)
        this.createButton(2, 'Turn Right', SINGLE)
        this.createButton(3, 'Turn Left', SINGLE)
        this.type = {
          key: 'expectedrotation',
          homekitValue: (v) => { return v > 0 ? 2 : 3 },
          homekitAction: () => {
            return Characteristic.ProgrammableSwitchEvent.SINGLE_PRESS
          }
        }
      } else {
        this.log.warn(
          '%s: %s: warning: ignoring unknown %s sensor %j',
          this.bridge.name, this.resource, this.obj.type, this.obj
        )
      }
      break
    case 'CLIPSwitch': // 2.1
      // We'd need a way to specify the number of buttons, cf. max value for
      // a CLIPGenericStatus sensor.
      this.log.warn(
        '%s: %s: warning: ignoring unsupported sensor type %s',
        this.bridge.name, this.resource, this.obj.type
      )
      break
    case 'ZLLPresence':
      // falls through
    case 'ZHAPresence':
      if (
        ['Philips', 'Signify Netherlands B.V.'].includes(this.obj.manufacturername) &&
        ['SML001', 'SML002', 'SML003', 'SML004'].includes(this.obj.modelid)
      ) {
        // 1.3 - Hue motion sensor
        durationKey = 'delay'
      } else if (
        this.obj.manufacturername === 'IKEA of Sweden' &&
        this.obj.modelid === 'TRADFRI motion sensor'
      ) {
        // Ikea Trådfri motion sensor
        this.obj.state.dark = false
      } else if (
        this.obj.manufacturername === 'LUMI' && (
          this.obj.modelid === 'lumi.sensor_motion' ||
          this.obj.modelid === 'lumi.sensor_motion.aq2'
        )
      ) {
        // Xiaomi motion sensor
        // Xiaomi Aqara motion sensor
      } else if (
        this.obj.manufacturername === 'Heiman' &&
        this.obj.modelid === 'PIR_TPV11'
      ) {
        // Heiman motion sensor
      } else if (
        this.obj.manufacturername === 'SmartThings' &&
        this.obj.modelid === 'tagv4'
      ) {
        // Samsung SmartThings arrival sensor
      } else if (
        this.obj.manufacturername === 'Konke' &&
        this.obj.modelid === '3AFE28010402000D'
      ) {
        // Konke motion sensor
      } else if (
        this.obj.manufacturername === 'SILVERCREST' &&
        this.obj.modelid === 'TY0202'
      ) {
        // LIDL motion sensor, see #979.
      } else {
        this.log.warn(
          '%s: %s: warning: unknown %s sensor %j',
          this.bridge.name, this.resource, this.obj.type, this.obj
        )
      }
      // falls through
    case 'CLIPPresence': // 2.3
    case 'Geofence': // Undocumented
      this.service = new eve.Services.MotionSensor(this.name, this.subtype)
      this.serviceList.push(this.service)
      this.duration = 0
      this.type = {
        Characteristic: Characteristic.MotionDetected,
        key: 'presence',
        name: 'motion',
        unit: '',
        history: 'motion',
        homekitValue: (v) => { return v ? 1 : 0 },
        durationKey: durationKey,
        sensitivitymax: this.obj.config.sensitivitymax
      }
      break
    case 'ZLLTemperature':
    case 'ZHATemperature':
      if (
        ['Philips', 'Signify Netherlands B.V.'].includes(this.obj.manufacturername) &&
        ['SML001', 'SML002', 'SML003', 'SML004'].includes(this.obj.modelid)
      ) {
        // 1.4 - Hue motion sensor
      } else if (
        this.obj.manufacturername === 'LUMI' && (
          this.obj.modelid === 'lumi.weather' ||
          this.obj.modelid === 'lumi.sensor_ht'
        )
      ) {
        // Xiaomi temperature/humidity sensor
        // Xiaomi Aqara weather sensor
      } else if (
        this.obj.manufacturername === 'Heiman' &&
        (this.obj.modelid === 'TH-H_V15' || this.obj.modelid === 'TH-T_V15')
      ) {
        // Heiman temperature/humidity sensor
      } else if (
        this.obj.manufacturername === 'Samjin' &&
        this.obj.modelid === 'button'
      ) {
        // Samsung SmartThings Button temperature sensor
      } else if (
        this.obj.manufacturername === 'Samjin' &&
        this.obj.modelid === 'multi'
      ) {
        // Samsung SmartThings multipurpose sensor
      } else if (
        this.obj.manufacturername === 'Develco Products AS' && (
          this.obj.modelid === 'SMSZB-120' ||
          this.obj.modelid === 'HESZB-120'
        )
      ) {
        // Develco smoke sensor
        // Develco heat sensor
      } else if (this.obj.modelid === 'lumi.airmonitor.acn01') {
        // Xiaomi Aquara TVOC Sensor
        temperatureHistory = 'room2'
      } else {
        this.log.warn(
          '%s: %s: warning: unknown %s sensor %j',
          this.bridge.name, this.resource, this.obj.type, this.obj
        )
      }
      // falls through
    case 'CLIPTemperature': // 2.4
      this.service = new eve.Services.TemperatureSensor(this.name, this.subtype)
      this.serviceList.push(this.service)
      this.type = {
        Characteristic: Characteristic.CurrentTemperature,
        key: 'temperature',
        name: 'temperature',
        unit: '°C',
        history: temperatureHistory,
        homekitValue: (v) => { return v ? Math.round(v / 10) / 10 : 0 }
      }
      break
    case 'ZHAAirQuality':
      if (
        this.obj.manufacturername === 'LUMI' &&
        this.obj.modelid === 'lumi.airmonitor.acn01'
      ) {
        // Xiaomi Aqara airquality sensor
      } else {
        this.log.warn(
          '%s: %s: warning: unknown %s sensor %j',
          this.bridge.name, this.resource, this.obj.type, this.obj
        )
      }
      // falls through
    case 'CLIPAirQuality':
      this.service = new Service.AirQualitySensor(this.name, this.subtype)
      this.serviceList.push(this.service)
      this.service
        .addOptionalCharacteristic(Characteristic.AirQuality)
      this.type = {
        Characteristic: Characteristic.VOCDensity,
        key: 'airqualityppb',
        name: 'VOC density',
        unit: ' µg/m³',
        props: { minValue: 0, maxValue: 65535, minStep: 1 },
        history: 'room2',
        homekitValue: (v) => {
          return v ? Math.round(v * 4.57) : 0
        }
      }
      break
    case 'ZLLLightLevel': // 2.7 - Hue Motion Sensor
    case 'ZHALightLevel':
      if (
        ['Philips', 'Signify Netherlands B.V.'].includes(this.obj.manufacturername) &&
        ['SML001', 'SML002', 'SML003', 'SML004'].includes(this.obj.modelid)
      ) {
        // 1.4 - Hue motion sensor
      } else if (
        this.obj.manufacturername === 'LUMI' &&
        this.obj.modelid === 'lumi.sensor_motion.aq2'
      ) {
        // Xiaomi Aqara motion sensor
      } else if (
        this.obj.manufacturername === 'LUMI' &&
        this.obj.modelid === 'lumi.sen_ill.mgl01'
      ) {
        // Xiaomi Mi light intensity sensor
      } else {
        this.log.warn(
          '%s: %s: warning: unknown %s sensor %j',
          this.bridge.name, this.resource, this.obj.type, this.obj
        )
      }
      // falls through
    case 'CLIPLightLevel': // 2.7
      this.service = new Service.LightSensor(this.name, this.subtype)
      this.serviceList.push(this.service)
      this.type = {
        Characteristic: Characteristic.CurrentAmbientLightLevel,
        key: 'lightlevel',
        name: 'light level',
        unit: ' lux',
        homekitValue: hkLightLevel
      }
      break
    case 'ZHAOpenClose':
      if (
        this.obj.manufacturername === 'LUMI' && (
          this.obj.modelid === 'lumi.sensor_magnet.aq2' ||
          this.obj.modelid === 'lumi.sensor_magnet'
        )
      ) {
        // Xiaomi Aqara door/window sensor
        // Xiaomi Mi door/window sensor
      } else if (
        this.obj.manufacturername === 'Heiman' &&
        this.obj.modelid === 'DOOR_TPV13'
      ) {
        // Heiman smart door sensor
      } else if (
        this.obj.manufacturername === 'Samjin' &&
        this.obj.modelid === 'multi'
      ) {
        // Samsung SmartThings multipurpose sensor
      } else {
        this.log.warn(
          '%s: %s: warning: unknown %s sensor %j',
          this.bridge.name, this.resource, this.obj.type, this.obj
        )
      }
      // falls through
    case 'CLIPOpenClose': // 2.2
      this.service = new eve.Services.ContactSensor(this.name, this.subtype)
      this.serviceList.push(this.service)
      this.type = {
        Characteristic: Characteristic.ContactSensorState,
        key: 'open',
        name: 'contact',
        unit: '',
        history: 'door',
        homekitValue: (v) => { return v ? 1 : 0 }
      }
      break
    case 'ZHAHumidity':
      if (
        this.obj.manufacturername === 'LUMI' && (
          this.obj.modelid === 'lumi.weather' ||
          this.obj.modelid === 'lumi.sensor_ht'
        )
      ) {
        // Xiaomi Aqara weather sensor
        // Xiaomi Mi temperature/humidity sensor
      } else if (this.obj.modelid === 'lumi.airmonitor.acn01') {
        // Xiaomi Aquara TVOC Sensor
        temperatureHistory = 'room2'
      } else if (
        this.obj.manufacturername === 'Heiman' &&
        (this.obj.modelid === 'TH-H_V15' || this.obj.modelid === 'TH-T_V15')
      ) {
        // Heiman temperature/humidity sensor
      } else {
        this.log.warn(
          '%s: %s: warning: unknown %s sensor %j',
          this.bridge.name, this.resource, this.obj.type, this.obj
        )
      }
      // falls through
    case 'CLIPHumidity': // 2.5
      this.service = new Service.HumiditySensor(this.name, this.subtype)
      this.serviceList.push(this.service)
      this.type = {
        Characteristic: Characteristic.CurrentRelativeHumidity,
        key: 'humidity',
        name: 'humidity',
        unit: '%',
        history: temperatureHistory,
        homekitValue: (v) => { return v ? Math.round(v / 100) : 0 }
      }
      break
    case 'ZHAPressure':
      if (
        this.obj.manufacturername === 'LUMI' &&
        this.obj.modelid === 'lumi.weather'
      ) {
        // Xiaomi Aqara weather sensor
      } else {
        this.log.warn(
          '%s: %s: warning: unknown %s sensor %j',
          this.bridge.name, this.resource, this.obj.type, this.obj
        )
      }
      // falls through
    case 'CLIPPressure':
      this.service = new eve.Services.AirPressureSensor(this.name, this.subtype)
      this.serviceList.push(this.service)
      this.type = {
        Characteristic: eve.Characteristics.AirPressure,
        key: 'pressure',
        name: 'pressure',
        unit: ' hPa',
        history: 'weather',
        homekitValue: (v) => { return v ? Math.round(v) : 0 }
      }
      this.service.updateCharacteristic(eve.Characteristics.Elevation, 0)
      break
    case 'ZHAAlarm':
      if (
        this.obj.manufacturername.toLowerCase() === 'heiman' &&
        this.obj.modelid.startsWith('WarningDevice')
      ) {
        // Heiman Siren
      } else {
        this.log.warn(
          '%s: %s: warning: unknown %s sensor %j',
          this.bridge.name, this.resource, this.obj.type, this.obj
        )
      }
      // falls through
    case 'CLIPAlarm':
      this.service = new my.Services.Resource(this.name, this.subtype)
      this.service.addOptionalCharacteristic(my.Characteristics.Alarm)
      this.serviceList.push(this.service)
      this.type = {
        Characteristic: my.Characteristics.Alarm,
        key: 'alarm',
        name: 'alarm',
        homekitValue: (v) => { return v ? 1 : 0 }
      }
      break
    case 'ZHACarbonMonoxide':
      if (
        this.obj.manufacturername === 'Heiman' &&
        this.obj.modelid === 'CO_V16'
      ) {
        // Heiman CO sensor
      } else {
        this.log.warn(
          '%s: %s: warning: unknown %s sensor %j',
          this.bridge.name, this.resource, this.obj.type, this.obj
        )
      }
      // falls through
    case 'CLIPCarbonMonoxide':
      this.service = new Service.CarbonMonoxideSensor(this.name, this.subtype)
      this.serviceList.push(this.service)
      this.type = {
        Characteristic: Characteristic.CarbonMonoxideDetected,
        key: 'carbonmonoxide',
        name: 'CO',
        unit: '',
        homekitValue: (v) => { return v ? 1 : 0 }
      }
      break
    case 'ZHAFire':
      if (
        this.obj.manufacturername.toLowerCase() === 'heiman' && (
          this.obj.modelid === 'SMOK_V16' ||
          this.obj.modelid === 'SMOK_YDLV10' ||
          this.obj.modelid === 'GAS_V15' ||
          this.obj.modelid === 'SmokeSensor-N-3.0' ||
          this.obj.modelid === 'SmokeSensor-EF-3.0' ||
          this.obj.modelid === 'GASSensor-EM'
        )
      ) {
        // Heiman fire sensor
        // Heiman gas sensor
      } else if (
        this.obj.manufacturername === 'Develco Products AS' && (
          this.obj.modelid === 'SMSZB-120' ||
          this.obj.modelid === 'HESZB-120'
        )
      ) {
        // Develco smoke sensor
        // Develco heat sensor
      } else {
        this.log.warn(
          '%s: %s: warning: unknown %s sensor %j',
          this.bridge.name, this.resource, this.obj.type, this.obj
        )
      }
      // falls through
    case 'CLIPFire':
      this.service = new Service.SmokeSensor(this.name, this.subtype)
      this.serviceList.push(this.service)
      this.type = {
        Characteristic: Characteristic.SmokeDetected,
        key: 'fire',
        name: 'smoke',
        unit: '',
        homekitValue: (v) => { return v ? 1 : 0 }
      }
      break
    case 'ZHAVibration':
      if (
        this.obj.manufacturername === 'LUMI' &&
        this.obj.modelid === 'lumi.vibration.aq1'
      ) {
        // Xiaomi vibration sensor
      } else if (
        this.obj.manufacturername === 'Samjin' &&
        this.obj.modelid === 'multi'
      ) {
        // Samsung SmartThings multipurpose sensor
      } else {
        this.log.warn(
          '%s: %s: warning: unknown %s sensor %j',
          this.bridge.name, this.resource, this.obj.type, this.obj
        )
      }
      // falls through
    case 'CLIPVibration':
      this.service = new eve.Services.MotionSensor(this.name, this.subtype)
      this.serviceList.push(this.service)
      this.duration = 0
      this.type = {
        Characteristic: Characteristic.MotionDetected,
        key: 'vibration',
        name: 'motion',
        unit: '',
        history: 'motion',
        durationKey: durationKey,
        homekitValue: (v) => { return v ? 1 : 0 },
        sensitivitymax: this.obj.config.sensitivitymax
      }
      break
    case 'ZHAWater':
      if (
        (
          this.obj.manufacturername === 'LUMI' &&
          this.obj.modelid === 'lumi.sensor_wleak.aq1'
        ) || (
          this.obj.manufacturername === 'Heiman' &&
          this.obj.modelid === 'WATER_TPV11'
        )
      ) {
        // Xiaomi Aqara flood sensor
        // Heiman water sensor
      } else {
        this.log.warn(
          '%s: %s: warning: unknown %s sensor %j',
          this.bridge.name, this.resource, this.obj.type, this.obj
        )
      }
      // falls through
    case 'CLIPWater':
      this.service = new Service.LeakSensor(this.name, this.subtype)
      this.serviceList.push(this.service)
      this.type = {
        Characteristic: Characteristic.LeakDetected,
        key: 'water',
        name: 'leak',
        unit: '',
        homekitValue: (v) => { return v ? 1 : 0 }
      }
      break
    case 'ZHAConsumption':
      // falls through
    case 'CLIPConsumption':
      if (this.accessory.lightService == null) {
        this.service = new my.Services.Resource(this.name, this.subtype)
      } else {
        this.service = this.accessory.lightService
        // this.noSetNameCallback = true
      }
      this.serviceList.push(this.service)
      this.service
        .addOptionalCharacteristic(eve.Characteristics.TotalConsumption)
      this.type = {
        Characteristic: eve.Characteristics.TotalConsumption,
        key: 'consumption',
        name: 'total consumption',
        unit: ' kWh',
        history: 'energy',
        homekitValue: (v) => { return v / 1000.0 }
      }
      break
    case 'ZHAPower':
      // falls through
    case 'CLIPPower':
      if (this.accessory.lightService == null) {
        this.service = new my.Services.Resource(this.name, this.subtype)
      } else {
        this.service = this.accessory.lightService
        // this.noSetNameCallback = true
      }
      this.serviceList.push(this.service)
      this.service
        .addOptionalCharacteristic(eve.Characteristics.CurrentConsumption)
      this.type = {
        Characteristic: eve.Characteristics.CurrentConsumption,
        key: 'power',
        name: 'current consumption',
        unit: ' W',
        history: 'energy',
        homekitValue: (v) => { return v }
      }
      break
    case 'ZHAThermostat':
      if (
        this.obj.manufacturername === 'ELKO' &&
        this.obj.modelid === 'Super TR'
      ) {
        heatValue = 'heat'
      }
      // falls through
    case 'CLIPThermostat':
      if (this.obj.config.mode != null) {
        this.log.warn(
          '%s: %s: warning: incompatible %s sensor %j',
          this.bridge.name, this.resource, this.obj.type, this.obj
        )
      }
      this.service = new Service.Thermostat(this.name, this.subtype)
      this.serviceList.push(this.service)
      this.type = {
        Characteristic: Characteristic.CurrentTemperature,
        key: 'temperature',
        name: 'temperature',
        unit: '°C',
        history: 'thermo',
        heatValue: heatValue,
        homekitValue: (v) => { return v ? Math.round(v / 10) / 10 : 0 }
      }
      break
    case 'ZHATime':
      this.log.warn(
        '%s: %s: warning: ignoring unsupported sensor type %s',
        this.bridge.name, this.resource, this.obj.type
      )
      break
    case 'Daylight':
      if (
        this.obj.manufacturername === this.bridge.philips &&
        this.obj.modelid === 'PHDL00'
      ) {
        // 2.6 - Built-in daylight sensor.
        if (!this.obj.config.configured) {
          this.log.warn(
            '%s: %s: warning: %s sensor not configured',
            this.bridge.name, this.resource, this.obj.type
          )
        }
        this.manufacturer = this.obj.manufacturername
        this.model = this.obj.modelid
        this.service = new Service.LightSensor(this.name, this.subtype)
        this.serviceList.push(this.service)
        this.type = {
          Characteristic: Characteristic.CurrentAmbientLightLevel,
          key: 'lightlevel',
          name: 'light level',
          unit: ' lux',
          homekitValue: hkLightLevel
        }
        if (obj.state.status == null) {
          // Hue bridge
          obj.state.lightlevel = obj.state.daylight ? 65535 : 0
          obj.state.dark = !obj.state.daylight
        }
        obj.config.reachable = obj.config.configured
      } else {
        this.log.warn(
          '%s: %s: warning: ignoring unknown %s sensor %j',
          this.bridge.name, this.resource, this.obj.type, this.obj
        )
      }
      break
    case 'ZHABattery':
    case 'CLIPBattery':
      this.service = this.accessory.getBatteryService(
        this.obj.state.battery
      )
      // this.serviceList.push(this.service)
      this.type = {
        Characteristic: Characteristic.BatteryLevel,
        key: 'battery',
        name: 'battery',
        unit: '%',
        homekitValue: (v) => { return toInt(v, 0, 100) }
      }
      break
    case 'CLIPGenericFlag': // 2.8
      this.service = new Service.Switch(this.name, this.subtype)
      this.serviceList.push(this.service)
      this.type = {
        Characteristic: Characteristic.On,
        key: 'flag',
        name: 'on',
        unit: '',
        homekitValue: (v) => { return v },
        bridgeValue: (v) => { return v },
        setter: true
      }
      // Note that Eve handles a read-only switch correctly, but Home doesn't.
      if (
        this.obj.manufacturername === 'homebridge-hue' &&
        this.obj.modelid === 'CLIPGenericFlag' &&
        this.obj.swversion === '0'
      ) {
        this.type.props = {
          perms: [Characteristic.Perms.READ, Characteristic.Perms.NOTIFY]
        }
      }
      break
    case 'CLIPGenericStatus': // 2.9
      if (
        this.obj.manufacturername === 'Philips' &&
        this.obj.modelid === 'HUELABSVTOGGLE' && this.obj.swversion === '2.0'
      ) {
        // Hue labs toggle, see #1028.
        this.service = new Service.Switch(this.name, this.subtype)
        this.serviceList.push(this.service)
        this.type = {
          Characteristic: Characteristic.On,
          key: 'status',
          name: 'on',
          unit: '',
          homekitValue: (v) => { return v !== 0 },
          bridgeValue: (v) => { return v ? 1 : 0 },
          setter: true
        }
        break
      }
      this.service = new my.Services.Status(this.name, this.subtype)
      this.serviceList.push(this.service)
      this.type = {
        Characteristic: my.Characteristics.Status,
        key: 'status',
        name: 'status',
        unit: '',
        homekitValue: (v) => {
          return v > 127 ? 127 : v < -127 ? -127 : v
        },
        bridgeValue: (v) => { return v },
        setter: true
      }
      if (
        this.obj.manufacturername === 'homebridge-hue' &&
        this.obj.modelid === 'CLIPGenericStatus'
      ) {
        const min = parseInt(obj.swversion.split(',')[0])
        const max = parseInt(obj.swversion.split(',')[1])
        const step = parseInt(obj.swversion.split(',')[2])
        // Eve 3.1 displays the following controls, depending on the properties:
        // 1. {minValue: 0, maxValue: 1, minStep: 1}                    switch
        // 2. {minValue: a, maxValue: b, minStep: 1}, 1 < b - a <= 20   down|up
        // 3. {minValue: a, maxValue: b}, (a, b) != (0, 1)              slider
        // 4. {minValue: a, maxValue: b, minStep: 1}, b - a > 20        slider
        // Avoid the following bugs:
        // 5. {minValue: 0, maxValue: 1}                                nothing
        // 6. {minValue: a, maxValue: b, minStep: 1}, b - a = 1         switch*
        //    *) switch sends values 0 and 1 instead of a and b;
        if (min === 0 && max === 0) {
          this.type.props = {
            perms: [Characteristic.Perms.READ, Characteristic.Perms.NOTIFY]
          }
        } else if (min >= -127 && max <= 127 && min < max) {
          if (min === 0 && max === 1) {
            // Workaround Eve bug (case 5 above).
            this.type.props = { minValue: min, maxValue: max, minStep: 1 }
          } else if (max - min === 1) {
            // Workaround Eve bug (case 6 above).
            this.type.props = { minValue: min, maxValue: max }
          } else if (step !== 1) {
            // Default to slider for backwards compatibility.
            this.type.props = { minValue: min, maxValue: max }
          } else {
            this.type.props = { minValue: min, maxValue: max, minStep: 1 }
          }
        }
        this.log.debug(
          '%s: %s: props: %j', this.bridge.name,
          this.resource, this.type.props
        )
      }
      break
    default:
      this.log.warn(
        '%s: %s: warning: ignoring unknown sensor type %j',
        this.bridge.name, this.resource, this.obj
      )
      break
  }

  if (this.service) {
    if (this.type.Characteristic) {
      const char = this.service.getCharacteristic(this.type.Characteristic)
      if (this.type.props) {
        char.setProps(this.type.props)
      }
      if (this.type.setter) {
        char.on('set', this.setValue.bind(this))
      }
      if (this.type.history != null) {
        this.historyService = this.accessory
          .getHistoryService(this.type.history, this)
        this.history = this.accessory.history
        if (this.type.history !== this.history.type) {
          // History service already used for other type.
          this.historyService = null
          this.history = null
          this.type.history = null
        }
        const now = Math.round(new Date().valueOf() / 1000)
        const epoch = Math.round(
          new Date('2001-01-01T00:00:00Z').valueOf() / 1000
        )
        switch (this.type.history) {
          case 'door':
            this.hk.timesOpened = 0
            this.historyService
              .addOptionalCharacteristic(eve.Characteristics.ResetTotal)
            this.historyService.getCharacteristic(eve.Characteristics.ResetTotal)
              .setValue(now - epoch)
              .on('set', (value, callback) => {
                this.hk.timesOpened = 0
                this.service.updateCharacteristic(
                  eve.Characteristics.TimesOpened, this.hk.timesOpened
                )
                callback(null)
              })
            // falls through
          case 'motion':
            this.history.entry.status = 0
            break
          case 'energy':
            this.service
              .addOptionalCharacteristic(eve.Characteristics.TotalConsumption)
            this.service
              .addOptionalCharacteristic(eve.Characteristics.CurrentConsumption)
            if (this.history.resource.type.key === 'power') {
              this.history.consumption = 0
              this.history.totalConsumption = 0
              this.historyService
                .addOptionalCharacteristic(eve.Characteristics.ResetTotal)
              this.historyService
                .getCharacteristic(eve.Characteristics.ResetTotal)
                .setValue(now - epoch)
                .on('set', (value, callback) => {
                  this.history.totalConsumption = 0
                  this.service.updateCharacteristic(
                    eve.Characteristics.TotalConsumption,
                    this.history.totalConsumption
                  )
                  callback(null)
                })
            }
            this.history.entry.power = 0
            break
          case 'thermo':
            this.history.entry.currentTemp = 0
            this.history.entry.setTemp = 0
            this.history.entry.valvePosition = 0
            break
          case 'weather':
            this.history.entry.temp = 0
            this.history.entry.humidity = 0
            this.history.entry.pressure = 0
            break
          case 'room2':
            this.history.entry.temp = 0
            this.history.entry.humidity = 0
            this.history.entry.voc = 0
            break
          default:
            break
        }
      }
      this.checkValue(this.obj.state[this.type.key])
    }
    // if (this.obj.lastseen !== undefined) {
    //   this.service.addOptionalCharacteristic(my.Characteristics.LastSeen)
    //   this.checkLastSeen(this.obj.lastseen)
    // }
    this.service.addOptionalCharacteristic(my.Characteristics.LastUpdated)
    this.checkLastupdated(this.obj.state.lastupdated)
    if (this.obj.state.dark !== undefined) {
      this.service.addOptionalCharacteristic(my.Characteristics.Dark)
      this.checkDark(this.obj.state.dark)
    }
    if (this.obj.state.daylight !== undefined) {
      this.service.addOptionalCharacteristic(my.Characteristics.Daylight)
      this.checkDaylight(this.obj.state.daylight)
    }
    if (this.obj.state.sunrise !== undefined) {
      this.service.addOptionalCharacteristic(my.Characteristics.Sunrise)
      this.checkSunrise(this.obj.state.sunrise)
    }
    if (this.obj.state.sunset !== undefined) {
      this.service.addOptionalCharacteristic(my.Characteristics.Sunset)
      this.checkSunset(this.obj.state.sunset)
    }
    if (this.obj.state.tampered !== undefined && this.type.history !== 'door') {
      this.service.addOptionalCharacteristic(Characteristic.StatusTampered)
      this.checkTampered(this.obj.state.tampered)
    }
    if (this.obj.state.current !== undefined) {
      this.service.addOptionalCharacteristic(eve.Characteristics.ElectricCurrent)
      this.checkCurrent(this.obj.state.current)
    }
    if (this.obj.state.voltage !== undefined) {
      this.service.addOptionalCharacteristic(eve.Characteristics.Voltage)
      this.checkVoltage(this.obj.state.voltage)
    }
    if (this.obj.state.on !== undefined) {
      this.checkStateOn(this.obj.state.on)
    }
    if (this.obj.state.valve !== undefined) {
      this.service.addOptionalCharacteristic(eve.Characteristics.ValvePosition)
      this.checkValve(this.obj.state.valve)
    }
    if (
      this.obj.state.daylight !== undefined &&
      this.obj.state.status !== undefined
    ) {
      this.service.addOptionalCharacteristic(my.Characteristics.Status)
      this.service.getCharacteristic(my.Characteristics.Status)
        .setProps({
          minValue: 100,
          maxValue: 230,
          perms: [Characteristic.Perms.READ, Characteristic.Perms.NOTIFY]
        })
      this.service.addOptionalCharacteristic(my.Characteristics.LastEvent)
      this.service.addOptionalCharacteristic(my.Characteristics.Period)
      this.checkStatus(this.obj.state.status)
    }
    if (this.obj.config[this.type.durationKey] !== undefined) {
      this.checkDuration(this.obj.config[this.type.durationKey])
      this.service.getCharacteristic(eve.Characteristics.Duration)
        .on('set', this.setDuration.bind(this))
      delete this.duration
    } else if (this.duration !== undefined) {
      // Add fake duration for Hue motion sensor connected to the Hue bridge
      this.hk.duration = 5
      this.service.getCharacteristic(eve.Characteristics.Duration)
        .setValue(this.hk.duration)
        .on('set', this.setDuration.bind(this))
    }
    if (
      this.obj.config.sensitivity !== undefined &&
      this.obj.type !== 'ZHASwitch'
    ) {
      this.checkSensitivity(this.obj.config.sensitivity)
      if (this.type.sensitivitymax != null) {
        this.service.getCharacteristic(eve.Characteristics.Sensitivity)
          .on('set', this.setSensitivity.bind(this))
      }
    }
    if (this.type.key === 'temperature' && this.obj.config.offset !== undefined) {
      this.service.addOptionalCharacteristic(my.Characteristics.Offset)
      this.checkOffset(this.obj.config.offset)
      this.service.getCharacteristic(my.Characteristics.Offset)
        .on('set', this.setOffset.bind(this))
    }
    if (this.obj.config.heatsetpoint !== undefined) {
      this.service.getCharacteristic(Characteristic.CurrentHeatingCoolingState)
        .setProps({
          validValues: [
            Characteristic.CurrentHeatingCoolingState.OFF,
            Characteristic.CurrentHeatingCoolingState.HEAT
          ]
        })
      this.service.getCharacteristic(Characteristic.TargetHeatingCoolingState)
        .setProps({
          validValues: [
            Characteristic.TargetHeatingCoolingState.OFF,
            Characteristic.TargetHeatingCoolingState.HEAT
          ]
        })
        .on('set', this.setTargetHeatingCoolingState.bind(this))
      this.checkMode(this.obj.config.mode)
      if (this.obj.config.schedule_on !== undefined) {
        this.checkScheduleOn(this.obj.config.schedule_on)
      }
      this.service.getCharacteristic(Characteristic.TargetTemperature)
        .setProps({ minValue: 5, maxValue: 30, minStep: 0.5 })
        .on('set', this.setTargetTemperature.bind(this))
      this.checkHeatSetPoint(this.obj.config.heatsetpoint)
      this.service.addOptionalCharacteristic(eve.Characteristics.ProgramCommand)
      this.service.getCharacteristic(eve.Characteristics.ProgramCommand)
        .on('set', this.setProgramCommand.bind(this))
      this.service.addOptionalCharacteristic(eve.Characteristics.ProgramData)
      this.service.getCharacteristic(eve.Characteristics.ProgramData)
        // .setValue(Buffer.from('ff04f6', 'hex').toString('base64'))
        .on('get', this.getProgramData.bind(this))
    }
    if (this.obj.config.displayflipped !== undefined) {
      this.service.addOptionalCharacteristic(Characteristic.ImageMirroring)
      this.checkDisplayFlipped(this.obj.config.displayflipped)
      this.service.getCharacteristic(Characteristic.ImageMirroring)
        .on('set', this.setMirroring.bind(this))
    }
    if (this.obj.config.locked !== undefined) {
      this.service.addOptionalCharacteristic(Characteristic.LockPhysicalControls)
      this.checkLocked(this.obj.config.locked)
      this.service.getCharacteristic(Characteristic.LockPhysicalControls)
        .on('set', this.setLocked.bind(this))
    }
    this.service.addOptionalCharacteristic(Characteristic.StatusFault)
    this.checkReachable(this.obj.config.reachable)
    this.service.addOptionalCharacteristic(Characteristic.StatusActive)
    this.service.addOptionalCharacteristic(my.Characteristics.Enabled)
    this.checkOn(this.obj.config.on)
    this.service.getCharacteristic(my.Characteristics.Enabled)
      .on('set', this.setEnabled.bind(this))
    if (
      this.bridge.platform.config.resource &&
      !this.service.testCharacteristic(my.Characteristics.Resource)
    ) {
      this.service.addOptionalCharacteristic(my.Characteristics.Resource)
      this.service.getCharacteristic(my.Characteristics.Resource)
        .updateValue(this.resource)
    }
    if (
      this.bridge.platform.config.configuredName &&
      !this.service.testCharacteristic(Characteristic.ConfiguredName)
    ) {
      this.service.addCharacteristic(Characteristic.ConfiguredName)
      // this.service.addOptionalCharacteristic(Characteristic.ConfiguredName)
      // this.service.getCharacteristic(Characteristic.ConfiguredName)
      //   .on('set', this.setName.bind(this))
    }
  }
  if (this.obj.config.battery !== undefined) {
    this.batteryService = this.accessory.getBatteryService(
      this.obj.config.battery
    )
  }
}

HueSensor.prototype.createLabel = function (labelNamespace) {
  if (this.accessory.labelService == null) {
    this.service = new Service.ServiceLabel(this.name)
    this.service.getCharacteristic(Characteristic.ServiceLabelNamespace)
      .updateValue(labelNamespace)
    this.accessory.labelService = this.service
  } else {
    this.service = this.accessory.labelService
    // this.noSetNameCallback = true
  }
}

HueSensor.prototype.createButton = function (buttonIndex, buttonName, props) {
  // FIXME: subtype should be based on buttonIndex, not on buttonName.
  const service = new Service.StatelessProgrammableSwitch(
    this.name + ' ' + buttonName, buttonName
  )
  this.serviceList.push(service)
  this.buttonMap['' + buttonIndex] = service
  service.getCharacteristic(Characteristic.ProgrammableSwitchEvent)
    .setProps(props)
  service.getCharacteristic(Characteristic.ServiceLabelIndex)
    .setValue(buttonIndex)
}

// ===== Bridge Events =========================================================

HueSensor.prototype.heartbeat = function (beat, obj) {
  // this.checkName(obj.name)
  if (
    obj.state.daylight != null &&
    obj.state.lightlevel == null && obj.state.status == null
  ) {
    // Daylight sensor on Hue bridge.
    obj.state.lightlevel = obj.state.daylight ? 65535 : 0
    obj.state.dark = !obj.state.daylight
  }
  this.checkState(obj.state, false)
  if (obj.config.configured != null && obj.config.reachable == null) {
    obj.config.reachable = obj.config.configured
  }
  this.checkConfig(obj.config, false)
}

HueSensor.prototype.checkAttr = function (attr, event) {
  for (const key in attr) {
    switch (key) {
      case 'lastannounced':
        break
      case 'lastseen':
        // this.checkLastSeen(attr.lastseen)
        break
      // case 'name':
      //   this.checkName(attr.name)
      //   break
      default:
        break
    }
  }
}

HueSensor.prototype.checkState = function (state, event) {
  for (const key in state) {
    switch (key) {
      case 'airquality':
        this.checkAirQuality(state.airquality)
        break
      case 'angle':
        break
      case 'battery':
        this.accessory.checkBattery(state.battery)
        break
      case 'buttonevent':
        this.checkButtonevent(state.buttonevent, state.lastupdated, event)
        break
      case 'charging':
        this.checkCharging(state.charging)
        break
      case 'current':
        this.checkCurrent(state.current)
        break
      case 'dark':
        this.checkDark(state.dark)
        break
      case 'daylight':
        this.checkDaylight(state.daylight)
        break
      case 'eventduration':
      case 'expectedeventduration':
        break
      case 'expectedrotation':
        this.checkButtonevent(state.expectedrotation, state.lastupdated, event)
        break
      case 'gesture':
        break
      case 'lastupdated':
        this.checkLastupdated(state.lastupdated)
        break
      case 'lowbattery':
        break
      case 'lux':
        break
      case 'on':
        this.checkStateOn(state.on)
        break
      case 'orientation':
        break
      case 'rotaryevent':
        break
      case 'sunrise':
        this.checkSunrise(state.sunrise)
        break
      case 'sunset':
        this.checkSunset(state.sunset)
        break
      case 'tampered':
        this.checkTampered(state.tampered)
        break
      case 'test':
        if (state.test) {
          this.checkValue(true)
        }
        break
      case 'tiltangle':
        break
      case 'valve':
        this.checkValve(state.valve)
        break
      case 'vibrationstrength':
        break
      case 'voltage':
        this.checkVoltage(state.voltage)
        break
      case 'xy':
        break
      default:
        if (key === this.type.key) {
          this.checkValue(state[this.type.key])
        } else if (key === 'status') {
          this.checkStatus(state.status)
        } else if (key === 'power') {
          // this.checkPower(state.power)
        } else {
          this.log.debug(
            '%s: ignore unknown attribute state.%s', this.name, key
          )
        }
        break
    }
  }
}

HueSensor.prototype.checkValue = function (value) {
  if (value === undefined) {
    return
  }
  if (this.obj.state[this.type.key] !== value) {
    this.log.debug(
      '%s: sensor %s changed from %j to %j', this.name,
      this.type.key, this.obj.state[this.type.key], value
    )
    this.obj.state[this.type.key] = value
  }
  const hkValue = this.type.homekitValue(this.obj.state[this.type.key])
  if (this.durationTimer != null) {
    if (hkValue !== 0) {
      clearTimeout(this.durationTimer)
      this.durationTimer = null
      this.log.debug(
        '%s: cancel timer to keep homekit %s on %s%s for %ss', this.name,
        this.type.name, hkValue, this.type.unit, this.hk.duration
      )
    }
    return
  }
  if (this.hk[this.type.key] !== hkValue) {
    if (this.duration > 0 && hkValue === 0) {
      this.log.debug(
        '%s: keep homekit %s on %s%s for %ss', this.name, this.type.name,
        this.hk[this.type.key], this.type.unit, this.hk.duration
      )
      const saved = {
        oldValue: this.hk[this.type.key],
        value: hkValue,
        duration: this.hk.duration
      }
      this.durationTimer = setTimeout(() => {
        this.log.info(
          '%s: set homekit %s from %s%s to %s%s, after %ss',
          this.name, this.type.name, saved.oldValue, this.type.unit,
          saved.value, this.type.unit, saved.duration
        )
        this.durationTimer = null
        this.hk[this.type.key] = saved.value
        this.service
          .updateCharacteristic(this.type.Characteristic, this.hk[this.type.key])
        this.addEntry(true)
      }, this.duration * 1000)
      return
    }
    if (this.hk[this.type.key] !== undefined) {
      this.log.info(
        '%s: set homekit %s from %s%s to %s%s', this.name,
        this.type.name, this.hk[this.type.key], this.type.unit,
        hkValue, this.type.unit
      )
    }
    this.hk[this.type.key] = hkValue
    this.service
      .updateCharacteristic(this.type.Characteristic, this.hk[this.type.key])
    this.addEntry(true)
    if (
      this.type.key === 'power' && this.accessory.resource.config != null &&
      this.accessory.resource.config.outlet
    ) {
      const hkInUse = hkValue > 0 ? 1 : 0
      if (this.hk.inUse !== hkInUse) {
        if (this.hk.inUse !== undefined) {
          this.log.info(
            '%s: set homekit outlet in use from %s to %s', this.name,
            this.hk.inUse, hkInUse
          )
        }
        this.hk.inUse = hkInUse
        this.service.getCharacteristic(Characteristic.OutletInUse)
          .updateValue(this.hk.inUse)
      }
    }
  }
}

HueSensor.prototype.addEntry = function (changed) {
  if (this.history == null) {
    return
  }
  const initialising = this.history.entry.time == null
  const now = Math.round(new Date().valueOf() / 1000)
  this.history.entry.time = now
  switch (this.history.type) {
    case 'door':
      if (changed) {
        this.hk.timesOpened += this.hk[this.type.key]
        this.service.updateCharacteristic(
          eve.Characteristics.TimesOpened, this.hk.timesOpened
        )
      }
      // falls through
    case 'motion':
      if (changed) {
        this.hk.lastActivation = now - this.historyService.getInitialTime()
        this.service.updateCharacteristic(
          eve.Characteristics.LastActivation, this.hk.lastActivation
        )
      }
      this.history.entry.status = this.hk[this.type.key]
      break
    case 'energy':
      if (this.history.resource.type.key === 'power') {
        if (!initialising) {
          const delta = this.history.power * (now - this.history.time) // Ws
          this.history.consumption += Math.round(delta / 600.0) // W * 10 min
          this.history.totalConsumption += Math.round(delta / 3600.0) // Wh
        }
        this.history.power = this.hk.power
        this.history.time = now
      }
      if (changed || this.type.key !== this.history.resource.type.key) {
        return
      }
      if (this.history.resource.type.key === 'power') {
        this.history.entry.power = this.history.consumption
        this.history.consumption = 0
        this.log.info(
          '%s: set homekit total consumption to %s kWh', this.name,
          this.history.totalConsumption / 1000 // kWh
        )
        this.service.updateCharacteristic(
          eve.Characteristics.TotalConsumption, this.history.totalConsumption
        )
      } else {
        if (this.history.consumption != null) {
          const delta = this.obj.state.consumption -
                        this.history.consumption // Wh
          this.history.entry.power = delta * 6 // W * 10 min
          if (!this.accessory.resources.sensors.Power) {
            this.log.info(
              '%s: set homekit current consumption to %s W', this.name,
              this.hk.current, delta
            )
            this.service.updateCharacteristic(
              eve.Characteristics.CurrentConsumption, this.history.entry.power
            )
          }
        }
        this.history.consumption = this.obj.state.consumption
      }
      break
    case 'thermo':
      this.history.entry.currentTemp = this.hk.temperature
      this.history.entry.setTemp = this.hk.targetTemperature
      this.history.entry.valvePosition = this.hk.valvePosition
      if (changed) {
        return
      }
      break
    case 'weather':
      {
        const key = this.type.key === 'temperature' ? 'temp' : this.type.key
        this.history.entry[key] = this.hk[this.type.key]
        if (changed || this.type.key !== this.history.resource.type.key) {
          return
        }
      }
      break
    case 'room2':
      {
        const key = this.type.key === 'airqualityppb'
          ? 'voc'
          : (this.type.key === 'temperature' ? 'temp' : this.type.key)
        this.history.entry[key] = this.hk[this.type.key]
        if (changed || this.type.key !== this.history.resource.type.key) {
          return
        }
      }
      break
    default:
      return
  }
  if (initialising) {
    return
  }
  setTimeout(() => {
    // Make sure all weather entry attributes have been updated
    const entry = Object.assign({}, this.history.entry)
    this.log.debug('%s: add history entry %j', this.name, entry)
    this.historyService.addEntry(entry)
  }, 0)
}

HueSensor.prototype.checkButtonevent = function (
  buttonevent, lastupdated, event
) {
  if (event || this.obj.state.lastupdated < lastupdated) {
    this.log.debug(
      '%s: sensor %s %j on %s', this.name, this.type.key,
      buttonevent, this.obj.state.lastupdated
    )
    const buttonIndex = this.type.homekitValue(buttonevent)
    const action = this.type.homekitAction(
      buttonevent, this.obj.state.buttonevent,
      this.repeat != null && this.repeat.includes(buttonIndex)
    )
    this.obj.state.buttonevent = buttonevent
    if (
      buttonIndex != null && action != null &&
      this.buttonMap[buttonIndex] != null
    ) {
      const char = this.buttonMap[buttonIndex]
        .getCharacteristic(Characteristic.ProgrammableSwitchEvent)
      if (char.props.validValues.includes(action)) {
        this.log.info(
          '%s: homekit button %s', this.buttonMap[buttonIndex].displayName,
          { 0: 'single press', 1: 'double press', 2: 'long press' }[action]
        )
        char.updateValue(action)
      }
    }
  }
}

HueSensor.prototype.checkCharging = function (charging) {
  if (this.obj.state.charging !== charging) {
    this.log.debug(
      '%s: charging changed from %j to %j', this.name,
      this.obj.state.charging, charging
    )
    this.obj.state.charging = charging
  }
  const hkCharging = this.obj.state.charging
    ? Characteristic.ChargingState.CHARGING
    : Characteristic.ChargingState.NOT_CHARGING
  if (this.hk.charging !== hkCharging) {
    if (this.hk.charging !== undefined) {
      this.log.info(
        '%s: set homekit charging state from %j to %j', this.name,
        this.hk.charging, hkCharging
      )
    }
    this.hk.charging = hkCharging
    this.service.getCharacteristic(Characteristic.ChargingState)
      .updateValue(this.hk.charging)
  }
}

HueSensor.prototype.checkCurrent = function (current) {
  if (this.obj.state.current !== current) {
    this.log.debug(
      '%s: current changed from %s to %s', this.name,
      this.obj.state.current, current
    )
    this.obj.state.current = current
  }
  const hkCurrent = this.obj.state.current / 1000.0
  if (this.hk.current !== hkCurrent) {
    if (this.hk.current !== undefined) {
      this.log.info(
        '%s: set homekit electric current from %s A to %s A', this.name,
        this.hk.current, hkCurrent
      )
    }
    this.hk.current = hkCurrent
    this.service.getCharacteristic(eve.Characteristics.ElectricCurrent)
      .updateValue(this.hk.current)
  }
}

HueSensor.prototype.checkDark = function (dark) {
  if (this.obj.state.dark !== dark) {
    this.log.debug(
      '%s: sensor dark changed from %j to %j', this.name,
      this.obj.state.dark, dark
    )
    this.obj.state.dark = dark
  }
  const hkDark = this.obj.state.dark ? 1 : 0
  if (this.hk.dark !== hkDark) {
    if (this.hk.dark !== undefined) {
      this.log.info(
        '%s: set homekit dark from %s to %s', this.name,
        this.hk.dark, hkDark
      )
    }
    this.hk.dark = hkDark
    this.service
      .updateCharacteristic(my.Characteristics.Dark, this.hk.dark)
  }
}

HueSensor.prototype.checkDaylight = function (daylight) {
  if (this.obj.state.daylight !== daylight) {
    this.log.debug(
      '%s: sensor daylight changed from %j to %j', this.name,
      this.obj.state.daylight, daylight
    )
    this.obj.state.daylight = daylight
  }
  const hkDaylight = this.obj.state.daylight ? 1 : 0
  if (this.hk.daylight !== hkDaylight) {
    if (this.hk.daylight !== undefined) {
      this.log.info(
        '%s: set homekit daylight from %s to %s', this.name,
        this.hk.daylight, hkDaylight
      )
    }
    this.hk.daylight = hkDaylight
    this.service
      .updateCharacteristic(my.Characteristics.Daylight, this.hk.daylight)
  }
}

// HueSensor.prototype.checkLastSeen = function (lastseen) {
//   if (this.obj.lastseen !== lastseen) {
//     // this.log.debug(
//     //   '%s: lastseen changed from %s to %s', this.name,
//     //   this.obj.lastseen, lastseen
//     // )
//     this.obj.lastseen = lastseen
//   }
//   const hkLastSeen = dateToString(this.obj.lastseen).slice(0, -3)
//   if (this.hk.lastSeen !== hkLastSeen) {
//     // if (this.hk.lastSeen !== undefined) {
//     //   this.log.info(
//     //     '%s: set homekit last seen from %s to %s', this.name,
//     //     this.hk.lastSeen, hkLastSeen
//     //   )
//     // }
//     this.hk.lastSeen = hkLastSeen
//     this.service.getCharacteristic(my.Characteristics.LastSeen)
//       .updateValue(this.hk.lastSeen)
//   }
// }

HueSensor.prototype.checkLastupdated = function (lastupdated) {
  if (this.obj.state.lastupdated < lastupdated) {
    // this.log.debug(
    //   '%s: sensor lastupdated changed from %s to %s', this.name,
    //   this.obj.state.lastupdated, lastupdated
    // )
    this.obj.state.lastupdated = lastupdated
  }
  const hkLastupdated = dateToString(this.obj.state.lastupdated)
  if (this.hk.lastupdated !== hkLastupdated) {
    // this.log.info(
    //   '%s: set homekit last updated from %s to %s', this.name,
    //   this.hk.lastupdated, hkLastupdated
    // )
    this.hk.lastupdated = hkLastupdated
    this.service
      .updateCharacteristic(my.Characteristics.LastUpdated, this.hk.lastupdated)
  }
}

HueSensor.prototype.checkStatus = function (status) {
  if (this.obj.state.status !== status) {
    this.log.debug(
      '%s: sensor status changed from %j to %j', this.name,
      this.obj.state.status, status
    )
    this.obj.state.status = status
  }
  const hkStatus = this.obj.state.status
  if (this.hk.status !== hkStatus) {
    if (this.hk.status !== undefined) {
      this.log.info(
        '%s: set homekit status from %s to %s', this.name,
        this.hk.status, hkStatus
      )
    }
    this.hk.status = hkStatus
    this.service
      .updateCharacteristic(my.Characteristics.Status, this.hk.status)
  }
  const daylightEvent = daylightEvents[this.obj.state.status]
  if (daylightEvent == null) {
    return
  }
  const period = daylightPeriods[daylightEvent.period]
  this.checkValue(period.lightlevel)
  const hkEvent = daylightEvent.name
  if (this.hk.event !== hkEvent) {
    if (this.hk.event !== undefined) {
      this.log.info(
        '%s: set homekit last event from %s to %s', this.name,
        this.hk.event, hkEvent
      )
    }
    this.hk.event = hkEvent
    this.service
      .updateCharacteristic(my.Characteristics.LastEvent, this.hk.event)
  }
  const hkPeriod = daylightEvent.period
  if (this.hk.period !== hkPeriod) {
    if (this.hk.period !== undefined) {
      this.log.info(
        '%s: set homekit period from %s to %s', this.name,
        this.hk.period, hkPeriod
      )
    }
    this.hk.period = hkPeriod
    this.service
      .updateCharacteristic(my.Characteristics.Period, this.hk.period)
  }
}

HueSensor.prototype.checkStateOn = function (on) {
  if (this.obj.state.on !== on) {
    this.log.debug(
      '%s: sensor on changed from %j to %j', this.name,
      this.obj.state.on, on
    )
    this.obj.state.on = on
  }
  const hkCurrentHeatingCoolingState = on
    ? Characteristic.CurrentHeatingCoolingState.HEAT
    : Characteristic.CurrentHeatingCoolingState.OFF
  if (this.hk.currentHeatingCoolingState !== hkCurrentHeatingCoolingState) {
    if (this.hk.currentHeatingCoolingState !== undefined) {
      this.log.info(
        '%s: set homekit current heating cooling state from %s to %s', this.name,
        this.hk.currentHeatingCoolingState, hkCurrentHeatingCoolingState
      )
    }
    this.hk.currentHeatingCoolingState = hkCurrentHeatingCoolingState
    this.service.updateCharacteristic(
      Characteristic.CurrentHeatingCoolingState,
      this.hk.currentHeatingCoolingState
    )
  }
}

HueSensor.prototype.checkSunrise = function (sunrise) {
  if (this.obj.state.sunrise !== sunrise) {
    this.log.debug(
      '%s: sensor sunrise changed from %s to %s', this.name,
      this.obj.state.sunrise, sunrise
    )
    this.obj.state.sunrise = sunrise
  }
  const hkSunrise = dateToString(this.obj.state.sunrise)
  if (this.hk.sunrise !== hkSunrise) {
    if (this.hk.sunrise !== undefined) {
      this.log.info(
        '%s: set homekit sunrise from %s to %s', this.name,
        this.hk.sunrise, hkSunrise
      )
    }
    this.hk.sunrise = hkSunrise
    this.service
      .updateCharacteristic(my.Characteristics.Sunrise, this.hk.sunrise)
  }
}

HueSensor.prototype.checkSunset = function (sunset) {
  if (this.obj.state.sunset !== sunset) {
    this.log.debug(
      '%s: sensor sunset changed from %s to %s', this.name,
      this.obj.state.sunset, sunset
    )
    this.obj.state.sunset = sunset
  }
  const hkSunset = dateToString(this.obj.state.sunset)
  if (this.hk.sunset !== hkSunset) {
    if (this.hk.sunset !== undefined) {
      this.log.info(
        '%s: set homekit sunset from %s to %s', this.name,
        this.hk.sunset, hkSunset
      )
    }
    this.hk.sunset = hkSunset
    this.service
      .updateCharacteristic(my.Characteristics.Sunset, this.hk.sunset)
  }
}

HueSensor.prototype.checkTampered = function (tampered) {
  if (this.type.history === 'door') {
    return
  }
  if (this.obj.state.tampered !== tampered) {
    this.log.debug(
      '%s: sensor tampered changed from %j to %j', this.name,
      this.obj.state.tampered, tampered
    )
    this.obj.state.tampered = tampered
  }
  const hkTampered = this.obj.state.tampered ? 1 : 0
  if (this.hk.tampered !== hkTampered) {
    if (this.hk.tampered !== undefined) {
      this.log.info(
        '%s: set homekit status tampered from %s to %s', this.name,
        this.hk.tampered, hkTampered
      )
    }
    this.hk.tampered = hkTampered
    this.service
      .updateCharacteristic(Characteristic.StatusTampered, this.hk.tampered)
  }
}

HueSensor.prototype.checkValve = function (valve) {
  if (this.obj.state.valve !== valve) {
    this.log.debug(
      '%s: valve changed from %j to %j', this.name,
      this.obj.state.valve, valve
    )
    this.obj.state.valve = valve
  }
  const hkValve = Math.round(this.obj.state.valve / 2.55)
  if (this.hk.valvePosition !== hkValve) {
    if (this.hk.valvePosition !== undefined) {
      this.log.info(
        '%s: set homekit valve position from %s% to %s%', this.name,
        this.hk.valvePosition, hkValve
      )
    }
    this.hk.valvePosition = hkValve
    this.service.getCharacteristic(eve.Characteristics.ValvePosition)
      .updateValue(this.hk.valvePosition)
  }
}

HueSensor.prototype.checkVoltage = function (voltage) {
  if (this.obj.state.voltage !== voltage) {
    this.log.debug(
      '%s: voltage changed from %j to %j', this.name,
      this.obj.state.voltage, voltage
    )
    this.obj.state.voltage = voltage
  }
  const hkVoltage = this.obj.state.voltage
  if (this.hk.voltage !== hkVoltage) {
    if (this.hk.voltage !== undefined) {
      this.log.info(
        '%s: set homekit voltage from %s V to %s V', this.name,
        this.hk.voltage, hkVoltage
      )
    }
    this.hk.voltage = hkVoltage
    this.service.getCharacteristic(eve.Characteristics.Voltage)
      .updateValue(this.hk.voltage)
  }
}

HueSensor.prototype.checkAirQuality = function (airquality) {
  if (this.obj.state.airquality !== airquality) {
    this.log.debug(
      '%s: airquality changed from %j to %j', this.name,
      this.obj.state.airquality, airquality
    )
    this.obj.state.airquality = airquality
  }

  let hkAirQuality = airQualityValues[airquality]
  if (!hkAirQuality) {
    hkAirQuality = Characteristic.AirQuality.UNKNOWN
  }

  if (this.hk.airquality !== hkAirQuality) {
    if (this.hk.airquality !== undefined) {
      this.log.info(
        '%s: set homekit airquality from %s to %s', this.name,
        this.hk.airquality, hkAirQuality
      )
    }
    this.hk.airquality = hkAirQuality
    this.service.getCharacteristic(Characteristic.AirQuality)
      .updateValue(this.hk.airquality)
  }
}

HueSensor.prototype.checkConfig = function (config) {
  for (const key in config) {
    switch (key) {
      case 'alert':
        break
      case 'battery':
        this.accessory.checkBattery(config.battery)
        break
      case 'configured':
        break
      case 'delay':
        if (this.type.durationKey === 'delay') {
          this.checkDuration(config.delay)
        }
        break
      case 'devicemode':
        if (config.devicemode !== this.obj.config.devicemode) {
          this.log.warn(
            '%s: restart homebridge to handle new devicemode %s',
            this.name, config.devicemode
          )
          this.obj.config.devicemode = config.devicemode
        }
        break
      case 'displayflipped':
        this.checkDisplayFlipped(config.displayflipped)
        break
      case 'duration':
        this.checkDuration(config.duration)
        break
      case 'enrolled':
        break
      case 'group':
        break
      case 'heatsetpoint':
        this.checkHeatSetPoint(config.heatsetpoint)
        break
      case 'lastchange':
        break
      case 'ledindication':
        break
      case 'locked':
        this.checkLocked(config.locked)
        break
      case 'mode':
        this.checkMode(config.mode)
        break
      case 'offset':
        this.checkOffset(config.offset)
        break
      case 'on':
        this.checkOn(config.on)
        break
      case 'pending':
        break
      case 'reachable':
        this.checkReachable(config.reachable)
        break
      case 'schedule':
      case 'scheduler':
      case 'scheduleron':
        break
      case 'schedule_on':
        this.checkScheduleOn(config.schedule_on)
        break
      case 'sensitivity':
        this.checkSensitivity(config.sensitivity)
        break
      case 'sensitivitymax':
        break
      case 'sunriseoffset':
        break
      case 'sunsetoffset':
        break
      case 'temperature':
        break
      case 'tholddark':
        break
      case 'tholdoffset':
        break
      case 'usertest':
        break
      default:
        this.log.debug(
          '%s: ignore unknown attribute config.%s', this.name, key
        )
        break
    }
  }
}

HueSensor.prototype.checkDisplayFlipped = function (displayflipped) {
  if (this.obj.config.displayflipped !== displayflipped) {
    this.log.debug(
      '%s: sensor displayflipped changed from %j to %j', this.name,
      this.obj.config.displayflipped, displayflipped
    )
    this.obj.config.displayflipped = displayflipped
  }
  const hkMirroring = this.obj.config.displayflipped
  if (this.hk.mirroring !== hkMirroring) {
    if (this.hk.mirroring !== undefined) {
      this.log.info(
        '%s: set homekit mirroring from %s to %s', this.name,
        this.hk.mirroring, hkMirroring
      )
    }
    this.hk.mirroring = hkMirroring
    this.service
      .updateCharacteristic(Characteristic.ImageMirroring, this.hk.mirroring)
  }
}

HueSensor.prototype.checkDuration = function (duration) {
  if (this.type.name !== 'motion') {
    // Workaround while IAS Zone sensors are exposed as ZHAPresence
    return
  }
  if (this.obj.config[this.type.durationKey] !== duration) {
    this.log.debug(
      '%s: sensor %s changed from %j to %j', this.name,
      this.type.durationKey, this.obj.config[this.type.durationKey], duration
    )
    this.obj.config[this.type.durationKey] = duration
  }
  const char = this.service.getCharacteristic(eve.Characteristics.Duration)
  let hkDuration
  for (const value of char.props.validValues) {
    hkDuration = value
    if (this.obj.config[this.type.durationKey] <= value) {
      break
    }
  }
  if (this.hk.duration !== hkDuration) {
    if (this.hk.duration !== undefined) {
      this.log.info(
        '%s: set homekit duration from %ss to %ss', this.name,
        this.hk.duration, hkDuration
      )
    }
    this.hk.duration = hkDuration
    this.service
      .updateCharacteristic(eve.Characteristics.Duration, this.hk.duration)
  }
}

HueSensor.prototype.checkHeatSetPoint = function (heatsetpoint) {
  if (this.obj.config.heatsetpoint !== heatsetpoint) {
    this.log.debug(
      '%s: sensor heatsetpoint changed from %j to %j', this.name,
      this.obj.config.heatsetpoint, heatsetpoint
    )
    this.obj.config.heatsetpoint = heatsetpoint
  }
  const hkTargetTemperature = Math.round(this.obj.config.heatsetpoint / 50) / 2
  if (this.hk.targetTemperature !== hkTargetTemperature) {
    if (this.hk.targetTemperature !== undefined) {
      this.log.info(
        '%s: set homekit target temperature from %s°C to %s°C', this.name,
        this.hk.targetTemperature, hkTargetTemperature
      )
    }
    this.hk.targetTemperature = hkTargetTemperature
    this.service.updateCharacteristic(
      Characteristic.TargetTemperature, this.hk.targetTemperature
    )
  }
}

HueSensor.prototype.checkLocked = function (locked) {
  if (this.obj.config.locked !== locked) {
    this.log.debug(
      '%s: sensor locked changed from %j to %j', this.name,
      this.obj.config.locked, locked
    )
    this.obj.config.locked = locked
  }
  const hkLocked = this.obj.config.locked ? 1 : 0
  if (this.hk.locked !== hkLocked) {
    if (this.hk.locked !== undefined) {
      this.log.info(
        '%s: set homekit locked from %s to %s', this.name,
        this.hk.locked, hkLocked
      )
    }
    this.hk.locked = hkLocked
    this.service
      .updateCharacteristic(Characteristic.LockPhysicalControls, this.hk.locked)
  }
}

HueSensor.prototype.checkMode = function (mode) {
  if (this.obj.type !== 'ZHAThermostat') {
    return
  }
  if (this.obj.config.mode !== mode) {
    this.log.debug(
      '%s: sensor mode changed from %j to %j', this.name,
      this.obj.config.mode, mode
    )
    this.obj.config.mode = mode
  }
  const hkTargetHeatingCoolingState = mode === 'off'
    ? Characteristic.TargetHeatingCoolingState.OFF
    : Characteristic.TargetHeatingCoolingState.HEAT
  if (this.hk.targetHeatingCoolingState !== hkTargetHeatingCoolingState) {
    if (this.hk.targetHeatingCoolingState !== undefined) {
      this.log.info(
        '%s: set homekit target heating cooling state from %s to %s', this.name,
        this.hk.targetHeatingCoolingState, hkTargetHeatingCoolingState
      )
    }
    this.hk.targetHeatingCoolingState = hkTargetHeatingCoolingState
    this.service.getCharacteristic(Characteristic.TargetHeatingCoolingState)
      .updateValue(this.hk.targetHeatingCoolingState)
  }
}

// HueSensor.prototype.checkName = function (name) {
//   if (this.obj.name !== name) {
//     this.log.debug(
//       '%s: name changed from %j to %j', this.name, this.obj.name, name
//     )
//     this.obj.name = name
//   }
//   const hkName = this.obj.name
//   if (this.hk.name !== hkName) {
//     if (this.hk.name !== undefined) {
//       this.log.info(
//         '%s: set homekit name from %j to %j', this.name, this.hk.name, hkName
//       )
//     }
//     this.hk.name = hkName
//     this.service.getCharacteristic(Characteristic.ConfiguredName)
//       .updateValue(hkName)
//     this.name = this.hk.name
//   }
// }

HueSensor.prototype.checkOffset = function (offset) {
  if (this.type.key !== 'temperature') {
    return
  }
  if (this.obj.config.offset !== offset) {
    this.log.debug(
      '%s: sensor offset changed from %j to %j', this.name,
      this.obj.config.offset, offset
    )
    this.obj.config.offset = offset
  }
  let hkOffset = toInt(this.obj.config.offset, -500, 500)
  hkOffset = Math.round(hkOffset / 10) / 10
  if (this.hk.offset !== hkOffset) {
    if (this.hk.offset !== undefined) {
      this.log.info(
        '%s: set homekit offset from %s°C to %s°C', this.name,
        this.hk.offset, hkOffset
      )
    }
    this.hk.offset = hkOffset
    this.service
      .updateCharacteristic(my.Characteristics.Offset, this.hk.offset)
  }
}

HueSensor.prototype.checkOn = function (on) {
  if (this.obj.config.on !== on) {
    this.log.debug(
      '%s: sensor on changed from %j to %j', this.name,
      this.obj.config.on, on
    )
    this.obj.config.on = on
  }
  const hkEnabled = this.obj.config.on
  if (this.hk.enabled !== hkEnabled) {
    if (this.hk.enabled !== undefined) {
      this.log.info(
        '%s: set homekit enabled from %s to %s', this.name,
        this.hk.enabled, hkEnabled
      )
    }
    this.hk.enabled = hkEnabled
    this.service
      .updateCharacteristic(Characteristic.StatusActive, this.hk.enabled)
      .updateCharacteristic(my.Characteristics.Enabled, this.hk.enabled)
  }
}

HueSensor.prototype.checkReachable = function (reachable) {
  if (this.obj.config.reachable !== reachable) {
    this.log.debug(
      '%s: sensor reachable changed from %j to %j', this.name,
      this.obj.config.reachable, reachable
    )
    this.obj.config.reachable = reachable
  }
  const hkFault = this.obj.config.reachable === false ? 1 : 0
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
}

HueSensor.prototype.checkScheduleOn = function (scheduleOn) {
  if (this.obj.config.schedule_on !== scheduleOn) {
    this.log.debug(
      '%s: sensor schedule_on changed from %j to %j', this.name,
      this.obj.config.scheduleOn, scheduleOn
    )
    this.obj.config.schedule_on = scheduleOn
  }
}

HueSensor.prototype.checkSensitivity = function (sensitivity) {
  if (this.obj.config.sensitivity == null || this.obj.type === 'ZHASwitch') {
    return
  }
  if (this.obj.config.sensitivity !== sensitivity) {
    this.log.debug(
      '%s: sensor sensitivity changed from %j to %j', this.name,
      this.obj.config.sensitivity, sensitivity
    )
    this.obj.config.sensitivity = sensitivity
  }
  const hkSensitivity = sensitivity === this.type.sensitivitymax
    ? 0
    : sensitivity === 0 ? 7 : 4
  if (this.hk.sensitivity !== hkSensitivity) {
    if (this.hk.sensitivity !== undefined) {
      this.log.info(
        '%s: set homekit sensitivity from %s to %s', this.name,
        this.hk.sensitivity, hkSensitivity
      )
    }
    this.hk.sensitivity = hkSensitivity
    this.service.updateCharacteristic(
      eve.Characteristics.Sensitivity, this.hk.sensitivity
    )
  }
}

// ===== Homekit Events ========================================================

HueSensor.prototype.identify = function (callback) {
  if (this.obj.config.alert === undefined) {
    return callback()
  }
  this.log.info('%s: identify', this.name)
  this.put('/config', { alert: 'select' }).then((obj) => {
    return callback()
  }).catch((error) => {
    return callback(error)
  })
}

HueSensor.prototype.setValue = function (value, callback) {
  if (typeof value === 'number') {
    value = Math.round(value)
  }
  if (value === this.hk[this.type.key]) {
    return callback()
  }
  this.log.info(
    '%s: homekit %s changed from %s%s to %s%s', this.name,
    this.type.name, this.hk[this.type.key], this.type.unit, value, this.type.unit
  )
  this.hk[this.type.key] = value
  const newValue = this.type.bridgeValue(value)
  const body = {}
  body[this.type.key] = newValue
  this.put('/state', body).then((obj) => {
    this.obj.state[this.type.key] = newValue
    this.value = newValue
    return callback()
  }).catch((error) => {
    return callback(error)
  })
}

HueSensor.prototype.setDuration = function (duration, callback) {
  if (duration === this.hk.duration) {
    return callback()
  }
  this.log.info(
    '%s: homekit duration changed from %ss to %ss', this.name,
    this.hk.duration, duration
  )
  this.hk.duration = duration
  const hueDuration = duration === 5 ? 0 : duration
  if (this.duration !== undefined) {
    this.duration = hueDuration
    return callback()
  }
  const body = {}
  body[this.type.durationKey] = hueDuration
  this.put('/config', body).then((obj) => {
    this.obj.config[this.type.durationKey] = hueDuration
    return callback()
  }).catch((error) => {
    return callback(error)
  })
}

HueSensor.prototype.setEnabled = function (enabled, callback) {
  if (enabled === this.hk.enabled) {
    return callback()
  }
  this.log.info(
    '%s: homekit enabled changed from %s to %s', this.name,
    this.hk.enabled, enabled
  )
  this.hk.enabled = enabled
  const on = this.hk.enabled
  this.put('/config', { on: on }).then((obj) => {
    this.obj.config.on = on
    this.service
      .updateCharacteristic(Characteristic.StatusActive, this.hk.enabled)
    return callback()
  }).catch((error) => {
    return callback(error)
  })
}

HueSensor.prototype.setLocked = function (locked, callback) {
  if (locked === this.hk.locked) {
    return callback()
  }
  this.log.info(
    '%s: homekit locked changed from %s to %s', this.name,
    this.hk.locked, locked
  )
  this.hk.locked = locked
  const hueLocked = !!this.hk.locked
  this.put('/config', { locked: hueLocked }).then((obj) => {
    this.obj.config.locked = hueLocked
    return callback()
  }).catch((error) => {
    return callback(error)
  })
}

HueSensor.prototype.setMirroring = function (mirroring, callback) {
  if (mirroring === this.hk.mirroring) {
    return callback()
  }
  this.log.info(
    '%s: homekit mirroring changed from %s to %s', this.name,
    this.hk.mirroring, mirroring
  )
  this.hk.mirroring = mirroring
  const displayflipped = this.hk.mirroring
  this.put('/config', { displayflipped: displayflipped }).then((obj) => {
    this.obj.config.displayflipped = displayflipped
    return callback()
  }).catch((error) => {
    return callback(error)
  })
}

// HueSensor.prototype.setName = function (name, callback) {
//   if (this.noSetNameCallback) {
//     callback = () => {}
//   }
//   if (name === this.hk.name) {
//     return callback()
//   }
//   name = name.trim() // .slice(0, 32).trim()
//   if (name === '') {
//     return callback(new Error())
//   }
//   this.log.info(
//     '%s: homekit name changed from %j to %j', this.name, this.hk.name, name
//   )
//   this.put('', { name: name }).then((obj) => {
//     if (obj.name == null) {
//       this.obj.name = name
//       this.hk.name = name
//       return callback(new Error())
//     }
//     this.obj.name = obj.name
//     this.name = obj.name
//     setImmediate(() => {
//       this.hk.name = name
//       this.service.getCharacteristic(Characteristic.ConfiguredName)
//         .updateValue(this.hk.name)
//     })
//     return callback()
//   }).catch((error) => {
//     return callback(error)
//   })
// }

HueSensor.prototype.setOffset = function (offset, callback) {
  offset = Math.round(offset * 10) / 10
  if (offset === this.hk.offset) {
    return callback()
  }
  this.log.info(
    '%s: homekit offset changed from %s to %s', this.name,
    this.hk.offset, offset
  )
  this.hk.offset = offset
  const hueOffset = Math.round(offset * 100)
  this.put('/config', { offset: hueOffset }).then((obj) => {
    this.obj.config.offset = hueOffset
    return callback()
  }).catch((error) => {
    return callback(error)
  })
}

HueSensor.prototype.setProgramCommand = function (value, callback) {
  const buffer = Buffer.from(value, 'base64')
  value = buffer.toString('hex')
  this.log.debug(
    '%s: homekit program command changed to %s', this.name,
    buffer.toString('hex').toUpperCase()
  )
  let offset
  let scheduleOn
  for (let i = 0; i < buffer.length; i++) {
    const opcode = buffer[i]
    switch (opcode) {
      case 0x00: // Begin
        this.log.debug('%s:   00 begin', this.name)
        break
      case 0x06: // End
        this.log.debug('%s:   06 end', this.name)
        break
      case 0x12: // Offset
        offset = buffer.readInt8(++i) / 10
        this.log.debug('%s:   12 offset: %s°C', this.name, offset.toFixed(1))
        break
      case 0x13: // Schedule Enable
        scheduleOn = buffer[++i] === 1
        this.log.debug('%s:   13 schudule_on %s', this.name, scheduleOn)
        break
      case 0x1A: // Away transitions
        {
          let s = ''
          for (let j = 1; j <= 8; j++) {
            if (buffer[i + j] !== 0xFF) {
              const time = buffer[i + j] * 10
              const h = ('0' + Math.floor(time / 60)).slice(-2)
              const m = ('0' + time % 60).slice(-2)
              s += ' ' + h + ':' + m
            }
          }
          this.log.debug('%s:   Free%s', this.name, s)
          i += 8
        }
        break
      case 0xF4: // Temperature
        {
          const now = (buffer[++i] / 2).toFixed(1)
          const low = (buffer[++i] / 2).toFixed(1)
          const high = (buffer[++i] / 2).toFixed(1)
          this.log.debug('%s:   F4 temp: %s°C, %s°C, %s°C', this.name, now, low, high)
        }
        break
      case 0xFC: // Time
        {
          const n = ('0' + buffer[++i]).slice(-2)
          const h = ('0' + buffer[++i]).slice(-2)
          const d = ('0' + buffer[++i]).slice(-2)
          const m = ('0' + buffer[++i]).slice(-2)
          const y = 2000 + buffer[++i]
          this.log.debug('%s:   FC time: %s-%s-%sT%s:%s', this.name, y, m, d, h, n)
        }
        break
      case 0xFA: // Daily transitions
        for (let d = 0; d <= 6; d++) {
          let s = ''
          for (let j = 1; j <= 8; j++) {
            if (buffer[i + j] !== 0xFF) {
              const time = buffer[i + j] * 10
              const h = ('0' + Math.floor(time / 60)).slice(-2)
              const m = ('0' + time % 60).slice(-2)
              s += ' ' + h + ':' + m
            }
          }
          this.log.debug(
            '%s:   %s %s', this.name,
            ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][d], s
          )
          i += 8
        }
        break
      case 0xFF: // Reset?
        i += 2
        this.log.debug('%s:   FF reset', this.name)
        break
      default: // Unknown
        this.log.debug(
          '%s:   %s', this.name,
          ('00' + buffer[i].toString(16).toUpperCase()).slice(-2)
        )
        break
    }
  }
  if (scheduleOn != null) {
    if (this.obj.config.schedule_on !== scheduleOn) {
      this.put('/config', { schedule_on: scheduleOn }).then((obj) => {
        this.obj.config.schedule_on = scheduleOn
        return callback()
      })
      return
    }
  }
  if (offset != null) {
    offset *= 100
    if (this.obj.config.offset !== offset) {
      this.put('/config', { offset: offset }).then((obj) => {
        this.obj.config.offset = offset
        return callback()
      })
      return
    }
  }
  callback()
}

HueSensor.prototype.getProgramData = function (callback) {
  let buffer = Buffer.alloc(1024)
  let offset = 0

  // Temperature Offset
  buffer[offset++] = 0x12
  buffer[offset++] = Math.round(this.obj.config.offset / 50) * 5
  // Scheduler
  buffer[offset++] = 0x13
  buffer[offset++] = this.obj.config.schedule_on ? 0x01 : 0x00
  // Install Status
  buffer[offset++] = 0x14
  buffer[offset++] = 0xC0
  // Vacation
  buffer[offset++] = 0x19
  buffer[offset++] = 0x00
  buffer[offset++] = 0xFF
  // Temperature
  buffer[offset++] = 0xF4
  buffer[offset++] = 15 * 2
  buffer[offset++] = 15 * 2
  buffer[offset++] = 15 * 2
  buffer[offset++] = 15 * 2
  // Time
  buffer[offset++] = 0xFC
  const dt = new Date()
  buffer[offset++] = dt.getMinutes()
  buffer[offset++] = dt.getHours()
  buffer[offset++] = dt.getDate()
  buffer[offset++] = dt.getMonth() + 1
  buffer[offset++] = dt.getFullYear() - 2000
  // Open Window
  buffer[offset++] = 0xF6
  buffer[offset++] = 0x00
  buffer[offset++] = 0x00
  buffer[offset++] = 0x00
  // Schedule
  buffer[offset++] = 0xFA
  for (let d = 0; d <= 6; d++) {
    buffer[offset++] = 0xFF
    buffer[offset++] = 0xFF
    buffer[offset++] = 0xFF
    buffer[offset++] = 0xFF
    buffer[offset++] = 0xFF
    buffer[offset++] = 0xFF
    buffer[offset++] = 0xFF
    buffer[offset++] = 0xFF
  }
  // Free day
  buffer[offset++] = 0x1A
  buffer[offset++] = 0xFF
  buffer[offset++] = 0xFF
  buffer[offset++] = 0xFF
  buffer[offset++] = 0xFF
  buffer[offset++] = 0xFF
  buffer[offset++] = 0xFF
  buffer[offset++] = 0xFF
  buffer[offset++] = 0xFF

  buffer = buffer.slice(0, offset)
  this.log.debug(
    '%s: get homekit program data return %s', this.name, buffer.toString('hex')
  )
  return callback(null, buffer.toString('base64'))
}

HueSensor.prototype.setTargetHeatingCoolingState = function (
  targetHeatingCoolingState, callback
) {
  if (targetHeatingCoolingState === this.hk.targetHeatingCoolingState) {
    return callback()
  }
  this.log.info(
    '%s: homekit target heating cooling state changed from %s to %s', this.name,
    this.hk.targetHeatingCoolingState, targetHeatingCoolingState
  )
  this.hk.targetHeatingCoolingState = targetHeatingCoolingState
  let mode
  switch (this.hk.targetHeatingCoolingState) {
    case Characteristic.TargetHeatingCoolingState.OFF:
      mode = 'off'
      break
    case Characteristic.TargetHeatingCoolingState.HEAT:
    default:
      mode = this.type.heatValue
      break
  }
  this.put('/config', { mode: mode }).then((obj) => {
    this.obj.config.mode = mode
    return callback()
  }).catch((error) => {
    return callback(error)
  })
}

HueSensor.prototype.setTargetTemperature = function (targetTemperature, callback) {
  if (targetTemperature === this.hk.targetTemperature) {
    return callback()
  }
  this.log.info(
    '%s: homekit target temperature changed from %s°C to %s°C', this.name,
    this.hk.targetTemperature, targetTemperature
  )
  this.hk.targetTemperature = targetTemperature
  const hueHeatSetPoint = Math.round(targetTemperature * 100)
  this.put('/config', { heatsetpoint: hueHeatSetPoint }).then((obj) => {
    this.obj.config.heatsetpoint = hueHeatSetPoint
    return callback()
  }).catch((error) => {
    return callback(error)
  })
}

HueSensor.prototype.setSensitivity = function (sensitivity, callback) {
  if (sensitivity === this.hk.sensitivity) {
    return callback()
  }
  this.log.info(
    '%s: homekit sensitivity changed from %s to %s', this.name,
    this.hk.sensitivity, sensitivity
  )
  this.hk.sensitivity = sensitivity
  const hueSensitivity = this.hk.sensitivity === 0
    ? this.type.sensitivitymax
    : this.hk.sensitivity === 7 ? 0 : Math.round(this.type.sensitivitymax / 2)
  this.put('/config', { sensitivity: hueSensitivity }).then((obj) => {
    this.obj.config.sensitivity = hueSensitivity
    return callback()
  }).catch((error) => {
    return callback(error)
  })
}

HueSensor.prototype.put = function (resource, body) {
  return this.bridge.put(this.resource + resource, body)
}
