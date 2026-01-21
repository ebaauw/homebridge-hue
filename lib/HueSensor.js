// homebridge-hue/lib/HueSensor.js
// Copyright © 2016-2026 Erik Baauw. All rights reserved.
//
// Homebridge plugin for Philips Hue.

function dateToString (date, utc = true) {
  if (date == null || date === 'none') {
    return 'n/a'
  }
  if (utc && !date.endsWith('Z')) {
    date += 'Z'
  }
  return String(new Date(date)).slice(0, 24)
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
      return Characteristic.ProgrammableSwitchEvent.LONG_PRESS
    default:
      return null
  }
}

// Link this module to homebridge.
let Service
let Characteristic
let my
let eve
// let HistoryService

let SINGLE
let SINGLE_LONG

class HueSensor {
  static setHomebridge (homebridge, _my, _eve) {
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
    SINGLE_LONG = {
      minValue: Characteristic.ProgrammableSwitchEvent.SINGLE_PRESS,
      maxValue: Characteristic.ProgrammableSwitchEvent.LONG_PRESS,
      validValues: [
        Characteristic.ProgrammableSwitchEvent.SINGLE_PRESS,
        Characteristic.ProgrammableSwitchEvent.LONG_PRESS
      ]
    }
  }

  constructor (accessory, id, obj) {
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
    switch (this.obj.type) {
      case 'ZGPSwitch':
      case 'ZLLSwitch': {
        this.buttonMap = {}
        let namespace = Characteristic.ServiceLabelNamespace.ARABIC_NUMERALS

        switch (this.obj.manufacturername) {
          case 'Lutron':
            switch (this.obj.modelid) {
              case 'Z3-1BRL': // Lutron Aurora, see #522.
                this.createButton(1, 'Button', SINGLE_LONG)
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
              case 'RDM004': // Hue wall switch module
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
              case 'RDM002': // Hue tap dial switch
                namespace = Characteristic.ServiceLabelNamespace.DOTS
                this.createButton(1, '1', events) // On/Off
                this.createButton(2, '2', events)
                this.createButton(3, '3', events)
                this.createButton(4, '4', events) // Hue
                if (repeat) this.repeat = [1, 2, 3, 4]
                break
              case 'ROM001': // Hue smart button
              case 'RDM003': // Hue smart button
              case 'RDM005': // Hue smart button (v2)
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
                this.convertButtonEvent = (value) => {
                  return {
                    34: 1002, // Press 1
                    1000: 1002,
                    16: 2002, // Press 2
                    2000: 2002,
                    17: 3002, // Press 3
                    3000: 3002,
                    18: 4002, // Press 4
                    4000: 4002,
                    100: 5000, // Press 1 and 2
                    101: 5002, // Release 1 and 2
                    98: 6000, // Press 3 and 4
                    99: 6002 // Release 3 and 4
                  }[value]
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
                this.createButton(1, 'Top Left', SINGLE)
                this.createButton(2, 'Bottom Left', SINGLE)
                this.createButton(3, 'Top Right', SINGLE)
                this.createButton(4, 'Bottom Right', SINGLE)
                this.createButton(5, 'Top Both', SINGLE)
                this.createButton(6, 'Bottom Both', SINGLE)
                this.convertButtonEvent = (value) => {
                  if (value < 1000) {
                    return {
                      16: 1000, // Press Top Left
                      20: 1002, // Release Top Left
                      17: 2000, // Press Bottom Left
                      21: 2002, // Release Bottom Left
                      19: 3000, // Press Top Right
                      23: 3002, // Relesase Top Right
                      18: 4000, // Press Botton Right
                      22: 4002, // Release Bottom Right
                      100: 5000, // Press Top Both
                      101: 5002, // Release Top Both
                      98: 6000, // Press Bottom Both
                      99: 6002 // Release Bottom Both
                    }[value]
                  }
                  return value
                }
                break
              }
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
            homekitValue: (v) => { return Math.floor(v / 1000) },
            homekitAction: hkZLLSwitchAction
          }
        } else {
          this.log.warn(
            '%s: %s: warning: ignoring unknown %s sensor %j',
            this.bridge.name, this.resource, this.obj.type, this.obj
          )
        }
        break
      }
      case 'ZLLRelativeRotary': {
        this.buttonMap = {}
        let namespace = Characteristic.ServiceLabelNamespace.ARABIC_NUMERALS
        let homekitValue
        if (
          this.obj.manufacturername === 'Signify Netherlands B.V.' &&
          this.obj.modelid === 'RDM002'
        ) {
          // Hue tap dial switch
          namespace = Characteristic.ServiceLabelNamespace.DOTS
          this.createButton(5, 'Turn Right', SINGLE)
          this.createButton(6, 'Turn Left', SINGLE)
          homekitValue = (v) => { return v > 0 ? 5 : 6 }
        } else if (
          this.obj.manufacturername === 'Lutron' &&
          this.obj.modelid === 'Z3-1BRL'
        ) {
          // Lutron Aurora, see #522.
          this.createButton(2, 'Turn Right', SINGLE)
          this.createButton(3, 'Turn Left', SINGLE)
          homekitValue = (v) => { return v > 0 ? 2 : 3 }
        }
        if (Object.keys(this.buttonMap).length > 0) {
          this.createLabel(namespace)
          this.type = {
            key: 'expectedrotation',
            homekitValue,
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
      }
      case 'CLIPSwitch': // 2.1
        // We'd need a way to specify the number of buttons, cf. max value for
        // a CLIPGenericStatus sensor.
        this.log.warn(
          '%s: %s: warning: ignoring unsupported sensor type %s',
          this.bridge.name, this.resource, this.obj.type
        )
        break
      case 'ZLLPresence':
        if (
          ['Philips', 'Signify Netherlands B.V.'].includes(this.obj.manufacturername) &&
          ['SML001', 'SML002', 'SML003', 'SML004'].includes(this.obj.modelid)
        ) {
          // 1.3 - Hue motion sensor
          durationKey = 'delay'
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
          durationKey,
          sensitivitymax: this.obj.config.sensitivitymax
        }
        break
      case 'ZLLTemperature':
        if (
          ['Philips', 'Signify Netherlands B.V.'].includes(this.obj.manufacturername) &&
          ['SML001', 'SML002', 'SML003', 'SML004'].includes(this.obj.modelid)
        ) {
          // 1.4 - Hue motion sensor
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
          history: 'weather',
          homekitValue: (v) => { return v ? Math.round(v / 10) / 10 : 0 }
        }
        break
      case 'ZLLLightLevel': // 2.7 - Hue Motion Sensor
        if (
          ['Philips', 'Signify Netherlands B.V.'].includes(this.obj.manufacturername) &&
          ['SML001', 'SML002', 'SML003', 'SML004'].includes(this.obj.modelid)
        ) {
          // 1.4 - Hue motion sensor
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
      case 'ZLLOpenClose':
        this.log.warn(
          '%s: %s: warning: unknown %s sensor %j',
          this.bridge.name, this.resource, this.obj.type, this.obj
        )
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
            perms: [Characteristic.Perms.PAIRED_READ, Characteristic.Perms.NOTIFY]
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
              perms: [Characteristic.Perms.PAIRED_READ, Characteristic.Perms.NOTIFY]
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
            case 'weather':
              this.history.entry.temp = 0
              this.history.entry.humidity = 0
              this.history.entry.pressure = 0
              break
            default:
              break
          }
        }
        this.checkValue(this.obj.state[this.type.key])
      }
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
      if (this.obj.state.tampered !== undefined && this.type.history !== 'door') {
        this.service.addOptionalCharacteristic(Characteristic.StatusTampered)
        this.checkTampered(this.obj.state.tampered)
      }
      if (this.obj.state.on !== undefined) {
        this.checkStateOn(this.obj.state.on)
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
            perms: [Characteristic.Perms.PAIRED_READ, Characteristic.Perms.NOTIFY]
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
      if (this.obj.config.sensitivity !== undefined) {
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

  createLabel (labelNamespace) {
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

  createButton (buttonIndex, buttonName, props) {
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

  heartbeat (beat, obj) {
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

  checkAttr (attr, event) {
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

  checkState (state, event) {
    for (const key in state) {
      switch (key) {
        case 'buttonevent':
          if (event || this.bridge.eventStream == null) {
            this.checkButtonevent(state.buttonevent, state.lastupdated)
          }
          break
        case 'dark':
          this.checkDark(state.dark)
          break
        case 'daylight':
          this.checkDaylight(state.daylight)
          break
        case 'expectedeventduration':
          break
        case 'expectedrotation':
          if (event || this.bridge.eventStream == null) {
            this.checkButtonevent(state.expectedrotation, state.lastupdated)
          }
          break
        case 'lastupdated':
          this.checkLastupdated(state.lastupdated)
          break
        case 'rotaryevent':
          break
        default:
          if (key === this.type.key) {
            this.checkValue(state[this.type.key])
          } else {
            this.log.debug(
              '%s: ignore unknown attribute state.%s', this.name, key
            )
          }
          break
      }
    }
  }

  checkValue (value) {
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

  addEntry (changed) {
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
      case 'weather':
        {
          const key = this.type.key === 'temperature' ? 'temp' : this.type.key
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

  checkButtonevent (rawEvent, lastupdated) {
    const event = this.convertButtonEvent?.(rawEvent) ?? rawEvent
    const previousEvent = this.convertButtonEvent?.(this.obj.state[this.type.key]) ??
      this.obj.state[this.type.key]
    if (
      rawEvent !== this.obj.state[this.type.key] ||
      lastupdated > this.obj.state.lastupdated
    ) {
      this.log.debug(
        '%s: sensor %s %j on %s', this.name, this.type.key, rawEvent, lastupdated
      )
      this.obj.state[this.type.key] = rawEvent
    }
    if (event !== previousEvent || lastupdated > this.obj.state.lastupdated) {
      const buttonIndex = this.type.homekitValue(event)
      const action = this.type.homekitAction(
        event, previousEvent,
        this.repeat != null && this.repeat.includes(buttonIndex)
      )
      if (buttonIndex != null && action != null && this.buttonMap[buttonIndex] != null) {
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

  checkDark (dark) {
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

  checkDaylight (daylight) {
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

  checkLastupdated (lastupdated) {
    if (this.obj.state.lastupdated < lastupdated) {
      this.log.debug(
        '%s: sensor lastupdated changed from %s to %s', this.name,
        this.obj.state.lastupdated, lastupdated
      )
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

  checkStatus (status) {
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
  }

  checkConfig (config) {
    for (const key in config) {
      switch (key) {
        case 'alert':
          break
        case 'battery':
          this.accessory.checkBattery(config.battery)
          break
        case 'configured':
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
        case 'devicemodevalues':
          break
        case 'ledindication':
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

  // checkName (name) {
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

  checkOn (on) {
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

  checkReachable (reachable) {
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

  checkSensitivity (sensitivity) {
    if (this.obj.config.sensitivity == null) {
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

  identify (callback) {
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

  setValue (value, callback) {
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

  setDuration (duration, callback) {
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

  setEnabled (enabled, callback) {
    if (enabled === this.hk.enabled) {
      return callback()
    }
    this.log.info(
      '%s: homekit enabled changed from %s to %s', this.name,
      this.hk.enabled, enabled
    )
    this.hk.enabled = enabled
    const on = this.hk.enabled
    this.put('/config', { on }).then((obj) => {
      this.obj.config.on = on
      this.service
        .updateCharacteristic(Characteristic.StatusActive, this.hk.enabled)
      return callback()
    }).catch((error) => {
      return callback(error)
    })
  }

  // setName (name, callback) {
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

  setSensitivity (sensitivity, callback) {
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

  put (resource, body) {
    return this.bridge.put(this.resource + resource, body)
  }
}

export { HueSensor }
