// homebridge-hue/lib/HueSensor.js
// Copyright © 2016-2018 Erik Baauw. All rights reserved.
//
// Homebridge plugin for Philips Hue.
//
// HueSensor provides support for Philips Hue sensors.
//
// TODO:
// - Only expose a single ServiceLabel Service for multi-resource switches.
//   Probably need to re-introduce Resource Service for lastupdated, resource,
//   and config characteristics per resource.  Trick is to copy ServiceLabel
//   when the accessory hasn't got one already (e.g. ubisys dimmer where
//   lightBulb service is exposed first), but suppress it when it's already
//   there (e.g. second switch endpoint).
// - Check whether stateless switches are shown as unreachable.

'use strict';

const util = require('util');

// Link this module to HuePlatform.
module.exports = {
  setHomebridge: setHomebridge,
  HueSensor: HueSensor
};

// ===== Homebridge ============================================================

// Link this module to homebridge.
let Accessory;
let Service;
let Characteristic;
let SINGLE;
let DOUBLE;
let LONG;
const PRESS = 0;
const HOLD = 1;
const SHORT_RELEASE = 2;
const LONG_RELEASE = 3;

function setHomebridge(homebridge) {
  Accessory = homebridge.platformAccessory;
  Service = homebridge.hap.Service;
  Characteristic = homebridge.hap.Characteristic;
  SINGLE = Characteristic.ProgrammableSwitchEvent.SINGLE_PRESS;
  DOUBLE = Characteristic.ProgrammableSwitchEvent.DOUBLE_PRESS;
  LONG = Characteristic.ProgrammableSwitchEvent.LONG_PRESS;
}

function hkLightLevel(v) {
  let l = v ? Math.pow(10, (v - 1) / 10000) : 0.0001;
  l = Math.round(l * 10000) / 10000;
  return l > 100000 ? 100000 : l < 0.0001 ? 0.0001 : l;
}

// As homebridge-hue polls the Hue bridge, not all dimmer switch buttonevents
// are received reliably.  Consequently, we only issue one HomeKit change per
// Press/Hold/Release event series.
function hkZLLSwitchAction(value, oldValue) {
  const button = Math.floor(value / 1000);
  const oldButton = Math.floor(oldValue / 1000);
  const event = value % 1000;
  const oldEvent = oldValue % 1000;
  switch (event) {
    case PRESS:
      // Wait for Hold or Release after press.
      return null;
    case SHORT_RELEASE:
      return SINGLE;
    case HOLD:
    case LONG_RELEASE:
      if (button === oldButton && oldEvent === HOLD) {
        // Already issued action on previous Hold.
        return undefined;
      }
      return LONG;
  }
}

// ===== HueSensor =============================================================

function HueSensor(bridge, id, obj) {
  this.log = bridge.log;
  this.bridge = bridge;
  this.name = obj.name;
  this.obj = obj;
  this.hk = {};
  this.resource = '/sensors/' + id;
  this.infoService = new Service.AccessoryInformation();
  this.serviceList = [this.infoService];

  if (this.obj.type[0] === 'Z') {
    // Zigbee sensor.
    this.manufacturer = this.obj.manufacturername;
    this.model = this.obj.modelid;
    this.serialNumber = this.obj.uniqueid.split('-')[0];
    // this.subtype = this.obj.uniqueid.split('-')[1];
    this.version = this.obj.swversion;
  } else {
    // Hue bridge internal sensor.
    this.manufacturer = this.bridge.manufacturername;
    if (
      this.obj.manufacturername === 'homebridge-hue' &&
      this.obj.modelid === this.obj.type &&
      this.obj.uniqueid.split('-')[1] === id
    ) {
      // Combine multiple CLIP sensors into one accessory.
      this.model = 'MultiCLIP';
      this.serialNumber = this.bridge.serialNumber + this.obj.uniqueid.split('-')[0];
      this.subtype = this.obj.uniqueid.split('-')[1];
    } else {
      this.model = this.obj.type;
      this.serialNumber = this.bridge.serialNumber + this.resource;
    }
    this.version = this.bridge.version;
  }
  this.infoService
    .updateCharacteristic(Characteristic.Manufacturer, this.manufacturer)
    .updateCharacteristic(Characteristic.Model, this.model)
    .updateCharacteristic(Characteristic.SerialNumber, this.serialNumber)
    .updateCharacteristic(Characteristic.FirmwareRevision, this.version);
  // jshint -W106
  this.uuid_base = this.serialNumber;
  // jshint +W106

  // See: http://www.developers.meethue.com/documentation/supported-sensors
  switch(this.obj.type) {
    case 'ZGPSwitch':
      if (
        this.obj.manufacturername === 'Philips' &&
        this.obj.modelid === 'ZGPSWITCH'
      ) {
        // 1.1 - Hue tap
        this.createLabel(Characteristic.ServiceLabelNamespace.DOTS);
        this.createButton(1, '1', [SINGLE]);
        this.createButton(2, '2', [SINGLE]);
        this.createButton(3, '3', [SINGLE]);
        this.createButton(4, '4', [SINGLE]);
        this.type = {
          key:            'buttonevent',
          homekitValue:   function(v) {return {34: 1, 16: 2, 17: 3, 18: 4}[v];},
          homekitAction:  function() {return 0;}
        };
      } else {
        this.log.warn(
          '%s: %s: warning: unknown %s sensor %j',
          this.bridge.name, this.resource, this.obj.type, this.obj
        );
      }
      break;
    case 'ZLLSwitch':
    case 'ZHASwitch':
      if (
        this.obj.manufacturername === 'Philips' &&
        (this.obj.modelid === 'RWL021' || this.obj.modelid === 'RWL020')
      ) {
        // 1.2 - Hue wireless dimmer switch
        this.createLabel(Characteristic.ServiceLabelNamespace.ARABIC_NUMERALS);
        this.createButton(1, 'On', [SINGLE, LONG]);
        this.createButton(2, 'Dim Up', [SINGLE, LONG]);
        this.createButton(3, 'Dim Down', [SINGLE, LONG]);
        this.createButton(4, 'Off', [SINGLE, LONG]);
        this.type = {
          key:            'buttonevent',
          homekitValue:   function(v) {return Math.floor(v / 1000);},
          homekitAction:  hkZLLSwitchAction
        };
      } else if (
        this.obj.manufacturername === 'IKEA of Sweden' &&
        this.obj.modelid === 'TRADFRI remote control'
      ) {
        // Ikea Trådfri remote
        this.createLabel(Characteristic.ServiceLabelNamespace.ARABIC_NUMERALS);
        this.createButton(1, 'On/Off', [SINGLE]);
        this.createButton(2, 'Dim Up', [SINGLE, LONG]);
        this.createButton(3, 'Dim Down', [SINGLE, LONG]);
        this.createButton(4, 'Previous', [SINGLE, LONG]);
        this.createButton(5, 'Next', [SINGLE, LONG]);
        this.type = {
          key:            'buttonevent',
          homekitValue:   function(v) {return Math.floor(v / 1000);},
          homekitAction:  hkZLLSwitchAction
        };
      } else if (
        this.obj.manufacturername === 'IKEA of Sweden' &&
        this.obj.modelid === 'TRADFRI wireless dimmer'
      ) {
        // Ikea Trådfri dimmer
        this.createLabel(Characteristic.ServiceLabelNamespace.ARABIC_NUMERALS);
        this.createButton(1, 'On', [SINGLE]);
        this.createButton(2, 'Dim Up', [SINGLE]);
        this.createButton(3, 'Dim Down', [SINGLE]);
        this.createButton(4, 'Off', [SINGLE]);
        this.type = {
          key:            'buttonevent',
          homekitValue:   function(v) {return Math.floor(v / 1000);},
          homekitAction:  hkZLLSwitchAction
        };
      } else if (
          this.obj.manufacturername === 'ubisys' &&
          this.obj.modelid === 'D1 (5503)'
      ) {
        // ubisys D1 dimmer
        this.subtype = this.obj.uniqueid.split('-')[1];
        this.createLabel(Characteristic.ServiceLabelNamespace.ARABIC_NUMERALS);
        if (this.subtype === '02') {
          this.createButton(1, 'On/Off Left', [SINGLE]);
          this.createButton(2, 'Dim Up Left', [LONG]);
          this.createButton(3, 'Dim Down Left', [LONG]);
        } else {
          this.createButton(4, 'On/Off Right', [SINGLE]);
          this.createButton(5, 'Dim Up Right', [LONG]);
          this.createButton(6, 'Dim Down Right', [LONG]);
        }
        this.type = {
          key:            'buttonevent',
          homekitValue:   function(v) {return Math.floor(v / 1000);},
          homekitAction:  hkZLLSwitchAction
        };
      } else if (
        this.obj.manufacturername === 'LUMI' && (
          this.obj.modelid === 'lumi.sensor_switch.aq2' ||
          this.obj.modelid === 'lumi.sensor_switch' ||
          this.obj.modelid === 'lumi.sensor_86sw1'
        )
      ) {
        // Xiaomi Aqara smart wireless switch
        // Xiaomi Mi wireless switch
        // Xiaomi wall switch (single button)
        this.createLabel(Characteristic.ServiceLabelNamespace.ARABIC_NUMERALS);
        this.createButton(1, 'Button', [SINGLE]);
        this.type = {
          key:            'buttonevent',
          homekitValue:   function(v) {return Math.floor(v / 1000);},
          homekitAction:  hkZLLSwitchAction
        };
      } else if (
        this.obj.manufacturername === 'LUMI' &&
        this.obj.modelid === 'lumi.sensor_86sw2'
      ) {
        // Xiaomi wall switch (two buttons)
        this.createLabel(Characteristic.ServiceLabelNamespace.ARABIC_NUMERALS);
        this.createButton(1, 'Left', [SINGLE]);
        this.createButton(2, 'Right', [SINGLE]);
        this.createButton(3, 'Both', [SINGLE]);
        this.type = {
          key:            'buttonevent',
          homekitValue:   function(v) {return Math.floor(v / 1000);},
          homekitAction:  hkZLLSwitchAction
        };
      } else if (
        this.obj.manufacturername === 'LUMI' &&
        this.obj.modelid === 'lumi.sensor_cube'
      ) {
        // Xiaomi Mi smart cube
        this.subtype = this.obj.uniqueid.split('-')[1];
        this.createLabel(Characteristic.ServiceLabelNamespace.ARABIC_NUMERALS);
        if (this.subtype === '02') {
          this.createButton(1, 'Side 1', [SINGLE, DOUBLE, LONG]);
          this.createButton(2, 'Side 2', [SINGLE, DOUBLE, LONG]);
          this.createButton(3, 'Side 3', [SINGLE, DOUBLE, LONG]);
          this.createButton(4, 'Side 4', [SINGLE, DOUBLE, LONG]);
          this.createButton(5, 'Side 5', [SINGLE, DOUBLE, LONG]);
          this.createButton(6, 'Side 6', [SINGLE, DOUBLE, LONG]);
          this.createButton(7, 'Cube', [DOUBLE, LONG]);
          this.type = {
            key:            'buttonevent',
            homekitValue:   function(v) {return Math.floor(v / 1000);},
            homekitAction:  function(v) {
              if (v % 1000 === 0) {
                return LONG;
              } else if (v % 1000 === Math.floor(v / 1000)) {
                return DOUBLE;
              } else {
                return SINGLE;
              }
            }
          };
        } else {
          this.createButton(8, 'Right', [SINGLE, DOUBLE, LONG]);
          this.createButton(9, 'Left', [SINGLE, DOUBLE, LONG]);
          this.type = {
            key:            'buttonevent',
            homekitValue:   function(v) {return v > 0 ? 8 : 9;},
            homekitAction:  function(v) {
              return Math.abs(v) < 4500 ?
                SINGLE : Math.abs(v) < 9000 ? DOUBLE : LONG;
              }
          };
        }
      } else {
        this.log.warn(
          '%s: %s: warning: ignoring unknown %s sensor %j',
          this.bridge.name, this.resource, this.obj.type, this.obj
        );
      }
      break;
    case 'CLIPSwitch': // 2.1
      // We'd need a way to specify the number of buttons, cf. max value for
      // a CLIPGenericStatus sensor.
      this.log.warn(
        '%s: %s: warning: ignoring unsupported sensor type %s',
        this.bridge.name, this.resource, this.obj.type
      );
      break;
    case 'ZLLPresence':
    case 'ZHAPresence':
      if (
        this.obj.manufacturername === 'Philips' &&
        this.obj.modelid === 'SML001'
      ) {
        // 1.3 - Hue motion sensor
      } else if (
        this.obj.manufacturername === 'IKEA of Sweden' &&
        this.obj.modelid === 'TRADFRI motion sensor'
      ) {
        // Ikea Trådfri motion sensor
        this.obj.state.dark = false;
      } else if (
        this.obj.manufacturername === 'LUMI' && (
          this.obj.modelid === 'lumi.sensor_motion' ||
          this.obj.modelid === 'lumi.sensor_motion.aq2'
        )
      ) {
        // Xiaomi motion sensor
        // Xiaomi Aqara motion sensor
      } else {
        this.log.warn(
          '%s: %s: warning: unknown %s sensor %j',
          this.bridge.name, this.resource, this.obj.type, this.obj
        );
      }
      /* falls through */
    case 'CLIPPresence': // 2.3
    case 'Geofence':     // Undocumented
      this.service = new Service.MotionSensor(this.name, this.subtype);
      this.type = {
        Characteristic: Characteristic.MotionDetected,
        key:		        'presence',
        name:		        'motion',
        unit:		        '',
        homekitValue:   function(v) {return v ? 1 : 0;},
        readonlyDuration: this.obj.modelid === 'TRADFRI motion sensor'
      };
      break;
    case 'ZLLTemperature':
    case 'ZHATemperature':
      if (
        this.obj.manufacturername === 'Philips' &&
        this.obj.modelid === 'SML001'
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
      } else {
        this.log.warn(
          '%s: %s: warning: unknown %s sensor %j',
          this.bridge.name, this.resource, this.obj.type, this.obj
        );
      }
      /* falls through */
    case 'CLIPTemperature': // 2.4
      this.service = new Service.TemperatureSensor(this.name, this.subtype);
      this.type = {
        Characteristic:	Characteristic.CurrentTemperature,
        props:          { minValue: -273.2, maxValue: 1000.0 },
        key:		        'temperature',
        name:		        'temperature',
        unit:		        '°C',
        homekitValue:   function(v) {return v ? Math.round(v / 10) / 10 : 0;}
      };
      break;
    case 'ZLLLightLevel': // 2.7 - Hue Motion Sensor
    case 'ZHALightLevel':
      if (
        this.obj.manufacturername === 'Philips' &&
        this.obj.modelid === 'SML001'
      ) {
        // 1.4 - Hue motion sensor
      } else if (
        this.obj.manufacturername === 'LUMI' &&
        this.obj.modelid === 'lumi.sensor_motion.aq2'
      ) {
        // Xiaomi Aqara motion sensor
      } else {
        this.log.warn(
          '%s: %s: warning: unknown %s sensor %j',
          this.bridge.name, this.resource, this.obj.type, this.obj
        );
      }
      /* falls through */
    case 'CLIPLightLevel': // 2.7
      this.service = new Service.LightSensor(this.name, this.subtype);
      this.type = {
        Characteristic:	Characteristic.CurrentAmbientLightLevel,
        key:		        'lightlevel',
        name:		        'light level',
        unit:		        ' lux',
        homekitValue:   hkLightLevel
      };
      break;
    case 'ZHAOpenClose':
      if (
        this.obj.manufacturername === 'LUMI' && (
          this.obj.modelid === 'lumi.sensor_magnet.aq2' ||
          this.obj.modelid === 'lumi.sensor_magnet'
        )
      ) {
        // Xiaomi Aqara door/window sensor
        // Xiaomi Mi door/window sensor
      } else {
        this.log.warn(
          '%s: %s: warning: unknown %s sensor %j',
          this.bridge.name, this.resource, this.obj.type, this.obj
        );
      }
      /* falls through */
    case 'CLIPOpenClose': // 2.2
      this.service = new Service.ContactSensor(this.name, this.subtype);
      this.type = {
        Characteristic:	Characteristic.ContactSensorState,
        key:		        'open',
        name:		        'contact',
        unit:		        '',
        homekitValue:   function(v) {return v ? 1 : 0;}
      };
      break;
    case 'ZHAHumidity':
      if (
        this.obj.manufacturername === 'LUMI' && (
          this.obj.modelid === 'lumi.weather' ||
          this.obj.modelid === 'lumi.sensor_ht'
        )
      ) {
        // Xiaomi Aqara weather sensor
        // Xiaomi Mi temperature/humidity sensor
      } else {
        this.log.warn(
          '%s: %s: warning: unknown %s sensor %j',
          this.bridge.name, this.resource, this.obj.type, this.obj
        );
      }
      /* falls through */
    case 'CLIPHumidity': // 2.5
      this.service = new Service.HumiditySensor(this.name, this.subtype);
      this.type = {
        Characteristic:	Characteristic.CurrentRelativeHumidity,
        key:		        'humidity',
        name:		        'humidity',
        unit:		        '%',
        homekitValue:   function(v) {return v ? Math.round(v / 100) : 0;}
      };
      break;
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
        );
      }
      /* falls through */
    case 'CLIPPressure':
      this.service = new Service.AirPressureSensor(this.name, this.subtype);
      this.type = {
        Characteristic:	Characteristic.AirPressure,
        key:		        'pressure',
        name:		        'pressure',
        unit:		        ' hPa',
        homekitValue:   function(v) {return v ? Math.round(v) : 0;}
      };
      break;
    case 'Daylight':
      if (
        this.obj.manufacturername === 'Philips' &&
        this.obj.modelid === 'PHDL00'
      ) {
        // 2.6 - Built-in daylight sensor.
      } else {
        this.log.warn(
          '%s: %s: warning: unknown %s sensor %j',
          this.bridge.name, this.resource, this.obj.type, this.obj
        );
      }
      this.manufacturer = this.obj.manufacturername;
      this.model = this.obj.modelid;
      this.service = new Service.LightSensor(this.name, this.subtype);
      this.service.addOptionalCharacteristic(Characteristic.Daylight);
      this.type = {
        Characteristic: Characteristic.CurrentAmbientLightLevel,
        key:		        'daylight',
        name:		        'light level',
        unit:		        ' lux',
        homekitValue:   function(v) {return v ? 100000.0 : 0.0001;}
      };
      break;
    case 'CLIPGenericFlag':	// 2.8
      this.service = new Service.Switch(this.name, this.subtype);
      this.type = {
        Characteristic:	Characteristic.On,
        key:		        'flag',
        name:		        'power',
        unit:		        '',
        homekitValue:   function(v) {return v ? 1 : 0;},
        bridgeValue:    function(v) {return v ? true : false;},
        setter:         true
      };
      // Note that Eve handles a read-only switch correctly, but Home doesn't.
      if (
        this.obj.manufacturername === 'homebridge-hue' &&
        this.obj.modelid === 'CLIPGenericFlag' &&
        this.obj.swversion === '0'
      ) {
        this.type.props = {
          perms: [Characteristic.Perms.READ, Characteristic.Perms.NOTIFY]
        };
      }
      break;
    case 'CLIPGenericStatus': // 2.9
      this.service = new Service.Status(this.name, this.subtype);
      this.type = {
        Characteristic:	Characteristic.Status,
        key:		        'status',
        name:		        'status',
        unit:		        '',
        homekitValue:   function(v) {return v > 127 ? 127 : v < -127 ? -127 : v;},
        bridgeValue:    function(v) {return v;},
        setter:         true
      };
      if (
        this.obj.manufacturername === 'homebridge-hue' &&
        this.obj.modelid === 'CLIPGenericStatus'
      ) {
        let min = parseInt(obj.swversion.split(',')[0]);
        let max = parseInt(obj.swversion.split(',')[1]);
        if (min === 0 && max === 0) {
          this.type.props = {
            perms: [Characteristic.Perms.READ, Characteristic.Perms.NOTIFY]
          };
        } else if (min >= -127 && max <= 127 && min < max) {
          // this.log.debug(
          //   '%s: %s: min %d, max %d', this.bridge.name, this.resource, min, max
          // );
          // The way Eve displays the Status depends on the properties:
          // - [Off|On] slider when minValue = 0, maxValue = 1, and no
          //   stepValue has been specified;
          // - nothing when minValue = 0, maxValue = 1, and stepValue = 1.  This
          //   is a bug - Eve crashes when trying to include Status in a scene;
          // - [v|^] buttons when maxValue - minValue < 10 (?), and
          //   no stepValue has been specified;
          // - slider when stepValue = 1, or maxValue - minValue >= 10.
          this.type.props = {minValue: min, maxValue: max, stepValue: 1};
          if (min === 0 && max === 1) {
            // Workaround for Eve bug.
            this.type.props = {minValue: min, maxValue: max};
          }
        }
      }
      break;
    default:
      this.log.warn(
        '%s: %s: warning: ignoring unknown sensor type %j',
        this.bridge.name, this.resource, this.obj
      );
      break;
  }

  if (this.service) {
    if (this.type.Characteristic) {
      this.serviceList.push(this.service);
      const char = this.service.getCharacteristic(this.type.Characteristic);
      this.checkValue(this.obj.state[this.type.key]);
      char.on('get', (callback) => {
        callback(this.error, this.hk[this.type.key]);
      });
      if (this.type.props) {
        char.setProps(this.type.props);
      }
      if (this.type.setter) {
        char.on('set', this.setValue.bind(this));
      }
    }
    this.service.addOptionalCharacteristic(Characteristic.LastUpdated);
    this.checkLastupdated(this.obj.state.lastupdated);
    if (this.obj.state.dark !== undefined) {
      this.service.addOptionalCharacteristic(Characteristic.Dark);
      this.checkDark(this.obj.state.dark);
    }
    if (this.obj.state.daylight !== undefined) {
      this.service.addOptionalCharacteristic(Characteristic.Daylight);
      this.checkDaylight(this.obj.state.daylight);
    }
    if (this.obj.config.duration !== undefined) {
      this.service.addOptionalCharacteristic(Characteristic.Duration);
      this.checkDuration(this.obj.config.duration);
      if (this.type.readonlyDuration) {
        this.service.getCharacteristic(Characteristic.Duration).setProps(
          {perms: [Characteristic.Perms.READ, Characteristic.Perms.NOTIFY]}
        );
      } else {
        this.service.getCharacteristic(Characteristic.Duration)
          .on('set', this.setDuration.bind(this));
      }
    }
    if (this.obj.config.sensitivity !== undefined) {
      if (this.obj.config.duration === undefined) {
        // Add fake duration for Hue motion sensor connected to Hue bridge
        this.service.addOptionalCharacteristic(Characteristic.Duration);
        this.duration = 0;
        this.hk.duration = 0;
        this.service.getCharacteristic(Characteristic.Duration)
          .setvalue(this.hk.duration)
          .on('set', this.setDuration.bind(this));
      }
      this.service.addOptionalCharacteristic(Characteristic.Sensitivity);
      this.checkSensitivity(this.obj.config.sensitivity);
      this.service.getCharacteristic(Characteristic.Sensitivity)
        .setProps({maxValue: this.obj.config.sensitivitymax})
        .on('set', this.setSensitivity.bind(this));
    }
    this.service.addOptionalCharacteristic(Characteristic.StatusActive);
    this.service.addOptionalCharacteristic(Characteristic.Enabled);
    this.checkOn(this.obj.config.on);
    this.service.getCharacteristic(Characteristic.Enabled)
      .on('set', this.setEnabled.bind(this));
    if (this.bridge.platform.config.resource) {
      this.service.addOptionalCharacteristic(Characteristic.Resource);
      this.service.getCharacteristic(Characteristic.Resource)
        .updateValue(this.resource);
    }
  }
  if (this.obj.config.battery !== undefined) {
    this.batteryService = new Service.BatteryService(this.name);
    this.checkBattery(this.obj.config.battery);
    this.batteryService.getCharacteristic(Characteristic.ChargingState)
      .setValue(Characteristic.ChargingState.NOT_CHARGEABLE);
  }
}

HueSensor.prototype.getServices = function() {
  if (this.batteryService) {
    this.serviceList.push(this.batteryService);
  }
  return this.serviceList;
};

HueSensor.prototype.createLabel = function(labelNamespace) {
  this.service = new Service.ServiceLabel(this.name, this.subtype);
  this.serviceList.push(this.service);
  this.service.getCharacteristic(Characteristic.ServiceLabelNamespace)
    .on('get', (callback) => {return callback(this.error, labelNamespace);})
    .updateValue(labelNamespace);
  this.buttonMap = {};
};

HueSensor.prototype.createButton = function(buttonIndex, buttonName, values) {
  const service = new Service.StatelessProgrammableSwitch(
    this.name + ' ' + buttonName, buttonName
  );
  this.serviceList.push(service);
  this.buttonMap['' + buttonIndex] = service;
  service.getCharacteristic(Characteristic.ProgrammableSwitchEvent)
    .setProps({validValues: values});
  service.getCharacteristic(Characteristic.ServiceLabelIndex)
    .on('get', (callback) => {return callback(this.error, buttonIndex);})
    .setValue(buttonIndex);
};

// ===== Bridge Events =========================================================

HueSensor.prototype.heartbeat = function(obj) {
  this.checkState(obj.state, false);
  this.checkConfig(obj.config, false);
};

HueSensor.prototype.checkState = function(state, event) {
  for (const key in state) {
    switch (key) {
      case 'buttonevent':
        this.checkButtonevent(state.buttonevent, state.lastupdated, event);
        break;
      case 'dark':
        this.checkDark(state.dark);
        break;
      case 'daylight':
        this.checkDaylight(state.daylight);
        break;
      case 'lastupdated':
        this.checkLastupdated(state.lastupdated);
        break;
      case 'lux':
        break;
      default:
        if (key === this.type.key) {
          this.checkValue(state[this.type.key]);
        } else {
          this.log.debug(
            '%s: ignore unknown attribute state.%s', this.name, key
          );
        }
        break;
    }
  }
};

HueSensor.prototype.checkValue = function(value) {
  if (this.obj.state[this.type.key] !== value) {
    this.log.debug(
      '%s: sensor %s changed from %s to %s', this.name,
      this.type.key, this.obj.state[this.type.key], value
    );
    this.obj.state[this.type.key] = value;
  }
  const hkValue = this.type.homekitValue(this.obj.state[this.type.key]);
  if (this.hk[this.type.key] !== hkValue) {
    if (this.durationTimer) {
      clearTimeout(this.durationTimer);
      this.durationTimer = null;
    }
    if (this.duration > 0  && hkValue === 0) {
      this.log.debug(
        '%s: keep homekit %s on %s%s for %ds on %s', this.name,
        this.type.name, this.hk[this.type.key], this.type.unit, this.hk.duration,
        this.hk.lastupdated
      );
      const saved = {
        oldValue: this.hk[this.type.key],
        value: hkValue,
        duration: this.hk.duration,
        lastupdated: this.hk.lastupdated
      };
      this.durationTimer = setTimeout(() => {
        this.log.info(
          '%s: set homekit %s from %s%s to %s%s, %ds after %s',
          this.name, this.type.name, saved.oldValue, this.type.unit,
          saved.value, this.type.unit, saved.duration, saved.lastupdated
        );
        this.durationTimer = null;
        this.service
          .updateCharacteristic(this.type.Characteristic, saved.value);
      }, this.duration * 1000);
    } else {
      if (this.hk[this.type.key] !== undefined) {
        this.log.info(
          '%s: set homekit %s from %s%s to %s%s', this.name,
          this.type.name, this.hk[this.type.key], this.type.unit,
          hkValue, this.type.unit
        );
      }
      this.hk[this.type.key] = hkValue;
      this.service
        .updateCharacteristic(this.type.Characteristic, this.hk[this.type.key]);
    }
  }
};

HueSensor.prototype.checkButtonevent = function(
  buttonevent, lastupdated, event
) {
  if (event || this.obj.state.lastupdated !== lastupdated) {
    this.log.debug(
      '%s: sensor buttonevent %d on %s', this.name,
      buttonevent, this.obj.state.lastupdated
    );
    const buttonIndex = this.type.homekitValue(buttonevent);
    const action = this.type.homekitAction(
      buttonevent, this.obj.state.buttonevent
    );
    this.obj.state.buttonevent = buttonevent;
    if (buttonIndex !== undefined && action !== undefined) {
      this.log.info(
        '%s: homekit button %s', this.buttonMap[buttonIndex].displayName,
        {0: 'single press', 1: 'double press', 2: 'long press'}[action]
      );
      this.buttonMap[buttonIndex]
        .updateCharacteristic(Characteristic.ProgrammableSwitchEvent, action);
    }
  }
};

HueSensor.prototype.checkDark = function(dark) {
  if (this.obj.state.dark !== dark) {
    this.log.debug(
      '%s: sensor dark changed from %s to %s', this.name,
      this.obj.state.dark, dark
    );
    this.obj.state.dark = dark;
  }
  const hkDark = this.obj.state.dark ? 1 : 0;
  if (this.hk.dark !== hkDark) {
    if (this.hk.dark !== undefined) {
      this.log.info(
        '%s: set homekit dark from %s to %s', this.name,
        this.hk.dark, hkDark
      );
    }
    this.hk.dark = hkDark;
    this.service
      .updateCharacteristic(Characteristic.Dark, this.hk.dark);
  }
};

HueSensor.prototype.checkDaylight = function(daylight) {
  if (this.obj.state.daylight !== daylight) {
    this.log.debug(
      '%s: sensor daylight changed from %s to %s', this.name,
      this.obj.state.daylight, daylight
    );
    this.obj.state.daylight = daylight;
  }
  const hkDaylight = this.obj.state.daylight ? 1 : 0;
  if (this.hk.daylight !== hkDaylight) {
    if (this.hk.daylight !== undefined) {
      this.log.info(
        '%s: set homekit daylight from %s to %s', this.name,
        this.hk.daylight, hkDaylight
      );
    }
    this.hk.daylight = hkDaylight;
    this.service
      .updateCharacteristic(Characteristic.Daylight, this.hk.daylight);
  }
};

HueSensor.prototype.checkLastupdated = function(lastupdated) {
  if (this.obj.state.lastupdated !== lastupdated) {
    // this.log.debug(
    //   '%s: sensor lastupdated changed from %s to %s', this.name,
    //   this.obj.state.lastupdated, lastupdated
    // );
    this.obj.state.lastupdated = lastupdated;
  }
  const hkLastupdated =
    (this.obj.state.lastupdated && this.obj.state.lastupdated !== 'none') ?
    String(new Date(this.obj.state.lastupdated + 'Z')).substring(0, 24) : 'n/a';
  if (this.hk.lastupdated !== hkLastupdated) {
    // this.log.info(
    //   '%s: set homekit last updated from %s to %s', this.name,
    //   this.hk.lastupdated, hkLastupdated
    // );
    this.hk.lastupdated = hkLastupdated;
    this.service
      .updateCharacteristic(Characteristic.LastUpdated, hkLastupdated);
  }
};

HueSensor.prototype.checkConfig = function(config, heartbeat) {
  for (const key in config) {
    switch (key) {
      case 'alert':
        break;
      case 'battery':
        this.checkBattery(config.battery);
        break;
      case 'configured':
        break;
      case 'duration':
        this.checkDuration(config.duration);
        break;
      case 'group':
        break;
      case 'ledindication':
        break;
      case 'on':
        this.checkOn(config.on);
        break;
      case 'pending':
        break;
      case 'reachable':
        this.checkReachable(config.reachable);
        break;
      case 'sensitivity':
        this.checkSensitivity(config.sensitivity);
        break;
      case 'sensitivitymax':
        break;
      case 'sunriseoffset':
        break;
      case 'sunsetoffset':
        break;
      case 'tholddark':
        break;
      case 'tholdoffset':
        break;
      case 'usertest':
        break;
      default:
        this.log.debug(
          '%s: ignore unknown attribute config.%s', this.name, key
        );
        break;
    }
  }
};

HueSensor.prototype.checkBattery = function(battery)
{
  if (this.obj.config.battery !== battery) {
    this.log.debug(
      '%s: sensor battery changed from %s to %s', this.name,
      this.obj.config.battery, battery
    );
    this.obj.config.battery = battery;
  }
  const hkBattery = battery;
  if (this.hk.battery !== hkBattery) {
    if (this.hk.battery !== undefined) {
      this.log.info(
        '%s: set homekit battery level from %s%% to %s%%', this.name,
        this.hk.battery, hkBattery
      );
    }
    this.hk.battery = hkBattery;
    this.hk.lowBattery =
      this.hk.battery <= this.bridge.platform.config.lowBattery ?
      Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW :
      Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL;
    this.batteryService
      .updateCharacteristic(Characteristic.BatteryLevel, this.hk.battery)
      .updateCharacteristic(
        Characteristic.StatusLowBattery, this.hk.lowBattery
      );
  }
};

HueSensor.prototype.checkDuration = function(duration)
{
  if (this.obj.config.duration !== duration) {
    this.log.debug(
      '%s: sensor duration changed from %s to %s', this.name,
      this.obj.config.duration, duration
    );
    this.obj.config.duration = duration;
  }
  const hkDuration = this.obj.config.duration;
  if (this.hk.duration !== hkDuration) {
    if (this.hk.duration !== undefined) {
      this.log.info(
        '%s: set homekit duration from %ss to %ss', this.name,
        this.hk.duration, hkDuration
      );
    }
    this.hk.duration = hkDuration;
    this.service
      .updateCharacteristic(Characteristic.Duration, this.hk.duration);
  }
};

HueSensor.prototype.checkOn = function(on)
{
  if (this.obj.config.on !== on) {
    this.log.debug(
      '%s: sensor on changed from %s to %s', this.name,
      this.obj.config.on, on
    );
    this.obj.config.on = on;
  }
  const hkEnabled = this.obj.config.on ? 1 : 0;
  if (this.hk.enabled !== hkEnabled) {
    if (this.hk.enabled !== undefined) {
      this.log.info(
        '%s: set homekit enabled from %s to %s', this.name,
        this.hk.enabled, hkEnabled
      );
    }
    this.hk.enabled = hkEnabled;
    this.service
      .updateCharacteristic(Characteristic.StatusActive, this.hk.enabled)
      .updateCharacteristic(Characteristic.Enabled, this.hk.enabled);
    if (!on) {
      this.log.info('%s: not reachable (test)', this.name);
      this.error = true;
    }
  }
};

HueSensor.prototype.checkReachable = function(reachable)
{
  if (this.obj.config.reachable !== reachable) {
    this.log.debug(
      '%s: sensor reachable changed from %s to %s', this.name,
      this.obj.config.reachable, reachable
    );
    this.obj.config.reachable = reachable;
    this.log.info('%s: %sreachable', this.name, reachable ? '' : 'not ');
    this.error = reachable ? null : true;
  }
};

HueSensor.prototype.checkSensitivity = function(sensitivity)
{
  if (this.obj.config.sensitivity !== sensitivity) {
    this.log.debug(
      '%s: sensor sensitivity changed from %s to %s', this.name,
      this.obj.config.sensitivity, sensitivity
    );
    this.obj.config.sensitivity = sensitivity;
  }
  const hkSensitivity = sensitivity;
  if (this.hk.sensitivity !== hkSensitivity) {
    if (this.hk.sensitivity !== undefined) {
      this.log.info(
        '%s: set homekit sensitivity from %s to %s', this.name,
        this.hk.sensitivity, hkSensitivity
      );
    }
    this.hk.sensitivity = hkSensitivity;
    this.service.updateCharacteristic(
      Characteristic.Sensitivity, this.hk.sensitivity
    );
  }
};

// ===== Homekit Events ========================================================

HueSensor.prototype.identify = function(callback) {
  this.log.info('%s: identify', this.name);
  if (this.obj.config.alert === undefined) {
    return callback();
  }
  this.bridge.request('put', this.resource + '/config', {alert: 'select'})
  .then((obj) => {
    return callback();
  }).catch((err) => {
    return callback(true);
  });
};

HueSensor.prototype.setValue = function(value, callback) {
  if (value === this.hk[this.type.key]) {
    return callback();
  }
  this.log.info(
    '%s: homekit %s changed from %s%s to %s%s', this.name,
    this.type.name,	this.hk[this.type.key], this.type.unit, value, this.type.unit
  );
  this.hk[this.type.key] = value;
  const newValue = this.type.bridgeValue(value);
  const body = {};
  body[this.type.key] = newValue;
  this.bridge.request('put', this.resource + '/state', body)
  .then((obj) => {
    this.obj.state[this.type.key] = newValue;
    this.value = newValue;
    return callback();
  }).catch((err) => {
    return callback(true);
  });
};

HueSensor.prototype.setEnabled = function(enabled, callback) {
  enabled = enabled ? 1 : 0;
  if (enabled === this.hk.enabled) {
    return callback();
  }
  this.log.info(
    '%s: homekit enabled changed from %s to %s', this.name,
  	this.hk.enabled, enabled
  );
  this.hk.enabled = enabled;
  const on = this.hk.enabled ? true : false;
  this.bridge.request('put', this.resource + '/config', {on: on})
  .then((obj) => {
    this.obj.config.on = on;
    this.service
      .updateCharacteristic(Characteristic.StatusActive, this.hk.enabled);
    return callback();
  }).catch((err) => {
    return callback(true);
  });
};

HueSensor.prototype.setSensitivity = function(sensitivity, callback) {
  if (sensitivity === this.hk.sensitivity) {
    return callback();
  }
  this.log.info(
    '%s: homekit sensitivity changed from %s to %s', this.name,
  	this.hk.sensitivity, sensitivity
  );
  this.hk.sensitivity = sensitivity;
  this.bridge.request(
    'put', this.resource + '/config', {sensitivity: sensitivity}
  )
  .then((obj) => {
    this.obj.config.sensitivity = sensitivity;
    return callback();
  }).catch((err) => {
    return callback(true);
  });
};

HueSensor.prototype.setDuration = function(duration, callback) {
  if (duration === this.hk.duration) {
    return callback();
  }
  this.log.info(
    '%s: homekit duration changed from %ss to %ss', this.name,
  	this.hk.duration, duration
  );
  this.hk.duration = duration;
  if (this.duration !== undefined) {
    this.duration = duration;
    return callback();
  }
  this.bridge.request(
    'put', this.resource + '/config', {duration: duration}
  )
  .then((obj) => {
    this.obj.config.duration = duration;
    return callback();
  }).catch((err) => {
    return callback(true);
  });
};
