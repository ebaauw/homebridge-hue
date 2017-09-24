// homebridge-hue/lib/HueSensor.js
// Copyright © 2016, 2017 Erik Baauw. All rights reserved.
//
// Homebridge plugin for Philips Hue.
//
// HueSensor provides support for Philips Hue sensors.

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

function setHomebridge(homebridge) {
  Accessory = homebridge.platformAccessory;
  Service = homebridge.hap.Service;
  Characteristic = homebridge.hap.Characteristic;
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
    case 0:   // Press
      return undefined;         // Wait for Hold or Release after press.
    case 2:   // Release after press
      return Characteristic.ProgrammableSwitchEvent.SINGLE_PRESS;
    case 1:   // Hold
    case 3:   // Release after hold
      if (button === oldButton && oldEvent === 1) {
        // Already issued action on previous Hold.
        return undefined;
      }
      return Characteristic.ProgrammableSwitchEvent.LONG_PRESS;
  }
}

const SINGLE = 1;
const DOUBLE = 2;
const LONG = 4;

// ===== HueSensor =============================================================

function HueSensor(bridge, id, obj) {
  // jshint -W106
  this.log = bridge.log;
  this.bridge = bridge;
  this.name = obj.name;
  this.obj = obj;
  this.resource = '/sensors/' + id;
  this.infoService = new Service.AccessoryInformation();
  this.serviceList = [this.infoService];

  if (this.obj.type[0] === 'Z') {
    // Zigbee sensor.
    this.manufacturer = this.obj.manufacturername;
    this.model = this.obj.modelid;
    this.uuid_base = this.obj.uniqueid.split('-')[0];
    // this.subtype = this.obj.uniqueid.split('-')[1];
    // this.version = this.obj.swversion;
  } else {
    // Hue bridge internal sensor.
    this.manufacturer = this.bridge.obj.manufacturername;
    if (
      this.obj.manufacturername === 'homebridge-hue' &&
      this.obj.modelid === this.obj.type &&
      this.obj.uniqueid.split('-')[1] === id
    ) {
      // Combine multiple CLIP sensors into one accessory.
      this.model = 'MultiCLIP';
      this.uuid_base = this.bridge.uuid_base + this.obj.uniqueid.split('-')[0];
      this.subtype = this.obj.uniqueid.split('-')[1];
    } else {
      this.model = this.obj.type;
      this.uuid_base = this.bridge.uuid_base + this.resource;
    }
    // this.version = this.bridge.obj.swversion;
  }
  this.infoService
    .updateCharacteristic(Characteristic.Manufacturer, this.manufacturer)
    .updateCharacteristic(Characteristic.Model, this.model)
    .updateCharacteristic(Characteristic.SerialNumber, this.uuid_base);

  // See: http://www.developers.meethue.com/documentation/supported-sensors
  switch(this.obj.type) {
    case 'ZGPSwitch':
      if (
        this.obj.manufacturername === 'Philips' &&
        this.obj.modelid === 'ZGPSWITCH'
      ) {
        // 1.1 - Hue tap
        this.createButton(1, '1', SINGLE);
        this.createButton(2, '2', SINGLE);
        this.createButton(3, '3', SINGLE);
        this.createButton(4, '4', SINGLE);
        this.service = new Service.Resource(this.name, this.subtype);
        this.type = {
          key:            'buttonevent',
          homekitValue:   function(v) {return {34: 1, 16: 2, 17: 3, 18: 4}[v];},
          homekitAction:  function() {return 0;},
          ignoreReachable: true
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
        this.createButton(1, 'On', SINGLE + LONG);
        this.createButton(2, 'Dim Up', SINGLE + LONG);
        this.createButton(3, 'Dim Down', SINGLE + LONG);
        this.createButton(4, 'Off', SINGLE + LONG);
        this.service = new Service.Resource(this.name, this.subtype);
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
        this.createButton(1, 'On/Off', SINGLE);
        this.createButton(2, 'Dim Up', SINGLE + LONG);
        this.createButton(3, 'Dim Down', SINGLE + LONG);
        this.createButton(4, 'Previous', SINGLE + LONG);
        this.createButton(5, 'Next', SINGLE + LONG);
        this.service = new Service.Resource(this.name, this.subtype);
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
        const n = this.subtype - 1;
        const i = (this.subtype - 2) * 3;
        this.createButton(i + 1, 'On/Off ' + n, SINGLE);
        this.createButton(i + 2, 'Dim Up ' + n, LONG);
        this.createButton(i + 3, 'Dim Down ' + n, LONG);
        this.service = new Service.Resource(this.name, this.subtype);
        this.type = {
          key:            'buttonevent',
          homekitValue:   function(v) {return Math.floor(v / 1000);},
          homekitAction:  hkZLLSwitchAction
        };
      } else if (
        this.obj.manufacturername === 'LUMI' && (
          this.obj.modelid === 'lumi.sensor_switch.aq2' ||
          this.obj.modelid === 'lumi.sensor_switch'
        )
      ) {
        // Xiaomi Aqara smart wireless switch
        // Xiaomi Mi wireless switch
        this.createButton(1, 'Button');
        this.service = new Service.Resource(this.name, this.subtype);
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
        if (this.subtype === '02') {
          this.createButton(1, 'Side 1', SINGLE + DOUBLE + LONG);
          this.createButton(2, 'Side 2', SINGLE + DOUBLE + LONG);
          this.createButton(3, 'Side 3', SINGLE + DOUBLE + LONG);
          this.createButton(4, 'Side 4', SINGLE + DOUBLE + LONG);
          this.createButton(5, 'Side 5', SINGLE + DOUBLE + LONG);
          this.createButton(6, 'Side 6', SINGLE + DOUBLE + LONG);
          this.createButton(7, 'Cube', DOUBLE + LONG);
          this.service = new Service.Resource(this.name, this.subtype);
          this.type = {
            key:            'buttonevent',
            homekitValue:   function(v) {return Math.floor(v / 1000);},
            homekitAction:  function(v) {
              if (v % 1000 === 0) {
                return Characteristic.ProgrammableSwitchEvent.LONG_PRESS;
              } else if (v % 1000 === Math.floor(v / 1000)) {
                return Characteristic.ProgrammableSwitchEvent.DOUBLE_PRESS;
              } else {
                return Characteristic.ProgrammableSwitchEvent.SINGLE_PRESS;
              }
            }
          };
        } else {
          this.createButton(8, 'Right', SINGLE + DOUBLE + LONG);
          this.createButton(9, 'Left', SINGLE + DOUBLE + LONG);
          this.service = new Service.Resource(this.name, this.subtype);
          this.type = {
            key:            'buttonevent',
            homekitValue:   function(v) {return v > 0 ? 1 : 2;},
            homekitAction:  function(v) {
              return Math.abs(v) < 4500 ?
                Characteristic.ProgrammableSwitchEvent.SINGLE_PRESS :
                Math.abs(v) < 9000 ?
                  Characteristic.ProgrammableSwitchEvent.DOUBLE_PRESS :
                  Characteristic.ProgrammableSwitchEvent.LONG_PRESS;
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
      } else if (
        this.obj.manufacturername === 'LUMI' &&
        this.obj.modelid === 'lumi.sensor_motion.aq2'
      ) {
        // Xiaomi Aqare motion sensor
      } else {
        this.log.warn(
          '%s: %s: warning: unknown %s sensor %j',
          this.bridge.name, this.resource, this.obj.type, this.obj
        );
      }
      this.service = new Service.MotionSensor(this.name, this.subtype);
      this.type = {
        Characteristic: Characteristic.MotionDetected,
        key:		        'presence',
        name:		        'motion',
        unit:		        '',
        homekitValue:   function(v) {return v ? 1 : 0;}
      };
      break;
    case 'CLIPPresence': // 2.3
    case 'Geofence':    // Undocumented
      this.service = new Service.OccupancySensor(this.name, this.subtype);
      this.type = {
        Characteristic:	Characteristic.OccupancyDetected,
        key:		        'presence',
        name:		        'occupancy',
        unit:		        '',
        homekitValue:   function(v) {return v ? 1 : 0;}
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
        // Xiaomi Aqare motion sensor
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
    if (this.obj.type[0] !== 'Z') {
      this.type.ignoreReachable = true;
    }
    this.refresh();
    this.serviceList.push(this.service);
    if (this.type.Characteristic) {
      const char = this.service.getCharacteristic(this.type.Characteristic);
      if (this.type.props) {
        char.setProps(this.type.props);
      }
      char.updateValue(this.hk.value);
      if (this.type.setter) {
        char.on('set', this.setValue.bind(this));
      }
    }
    if (this.hk.dark !== undefined) {
      this.service.addOptionalCharacteristic(Characteristic.Dark);
      this.service.getCharacteristic(Characteristic.Dark)
        .updateValue(this.hk.dark);
    }
    if (this.hk.daylight !== undefined) {
      this.service.addOptionalCharacteristic(Characteristic.Daylight);
      this.service.getCharacteristic(Characteristic.Daylight)
        .updateValue(this.hk.daylight);
    }
    this.service.addOptionalCharacteristic(Characteristic.LastUpdated);
    this.service.getCharacteristic(Characteristic.LastUpdated)
      .updateValue(this.hk.lastupdated);
    this.service.addOptionalCharacteristic(Characteristic.Enabled);
    this.service.getCharacteristic(Characteristic.Enabled)
      .updateValue(this.hk.enabled)
      .on('set', this.setEnabled.bind(this));
    this.service.addOptionalCharacteristic(Characteristic.StatusActive);
    this.service.getCharacteristic(Characteristic.StatusActive)
      .updateValue(this.hk.enabled);
    if (!this.type.ignoreReachable && this.obj.config.reachable !== undefined) {
      this.service.addOptionalCharacteristic(Characteristic.StatusFault);
      this.service.getCharacteristic(Characteristic.StatusFault)
        .updateValue(this.hk.fault);
    }
    if (this.hk.sensitivity !== undefined) {
      this.service.addOptionalCharacteristic(Characteristic.Sensitivity);
      this.service.getCharacteristic(Characteristic.Sensitivity)
        .setProps({maxValue: this.obj.config.sensitivitymax})
        .updateValue(this.hk.sensitivity)
        .on('set', this.setSensitivity.bind(this));
      this.service.addOptionalCharacteristic(Characteristic.Duration);
      this.duration = 0;
      this.hk.duration = 0;
      this.service.getCharacteristic(Characteristic.Duration)
        .updateValue(this.hk.duration)
        .on('set', this.setDuration.bind(this));
    }
    if (this.bridge.platform.config.resource) {
      this.service.addOptionalCharacteristic(Characteristic.Resource);
      this.service.getCharacteristic(Characteristic.Resource)
        .updateValue(this.resource);
    }
    if (this.obj.config.battery) {
      this.batteryService = new Service.BatteryService(this.name);
      this.batteryService
        .updateCharacteristic(Characteristic.BatteryLevel, this.hk.battery)
        .updateCharacteristic(Characteristic.StatusLowBattery, this.hk.lowBattery)
        .updateCharacteristic(Characteristic.ChargingState, this.hk.charging);
    }
  }
}

HueSensor.prototype.getServices = function() {
  if (this.batteryService) {
    this.serviceList.push(this.batteryService);
  }
  return this.serviceList;
};

HueSensor.prototype.createButton = function(buttonIndex, buttonName, actions) {
  const service = new Service.StatelessProgrammableSwitch(
    this.name + ' ' + buttonName, buttonName
  );
  this.serviceList.push(service);
  let props;
  switch (actions) {
    case SINGLE:
      props = {
        minValue: Characteristic.ProgrammableSwitchEvent.SINGLE_PRESS,
        maxValue: Characteristic.ProgrammableSwitchEvent.SINGLE_PRESS
      };
      break;
    case DOUBLE:
      props = {
        minValue: Characteristic.ProgrammableSwitchEvent.DOUBLE_PRESS,
        maxValue: Characteristic.ProgrammableSwitchEvent.DOUBLE_PRESS
      };
      break;
    case SINGLE + DOUBLE:
      props = {
        minValue: Characteristic.ProgrammableSwitchEvent.SINGLE_PRESS,
        maxValue: Characteristic.ProgrammableSwitchEvent.DOUBLE_PRESS
      };
      break;
    case LONG:
      props = {
        minValue: Characteristic.ProgrammableSwitchEvent.LONG_PRESS,
        maxValue: Characteristic.ProgrammableSwitchEvent.LONG_PRESS
      };
      break;
    case SINGLE + LONG:
      props = {
        minValue: Characteristic.ProgrammableSwitchEvent.SINGLE_PRESS,
        maxValue: Characteristic.ProgrammableSwitchEvent.LONG_PRESS,
        validValues: [
          Characteristic.ProgrammableSwitchEvent.SINGLE_PRESS,
          Characteristic.ProgrammableSwitchEvent.LONG_PRESS
        ]
      };
      break;
    case DOUBLE + LONG:
      props = {
        minValue: Characteristic.ProgrammableSwitchEvent.DOUBLE_PRESS,
        maxValue: Characteristic.ProgrammableSwitchEvent.LONG_PRESS
      };
      break;
    default:
      props = {
        minValue: Characteristic.ProgrammableSwitchEvent.SINGLE_PRESS,
        maxValue: Characteristic.ProgrammableSwitchEvent.LONG_PRESS
      };
      break;
  }
  service.getCharacteristic(Characteristic.ProgrammableSwitchEvent)
    .setProps(props);
  service.getCharacteristic(Characteristic.ServiceLabelIndex)
    .setValue(buttonIndex);
};

// Translate bridge values to homekit values.
HueSensor.prototype.refresh = function() {
  this.value = this.obj.state[this.type.key];
  this.hk = {};
  this.hk.value = this.type.homekitValue(this.value);
  if (this.obj.state.dark !== undefined) {
    this.hk.dark = this.obj.state.dark ? 1 : 0;
  }
  if (this.obj.state.daylight !== undefined) {
    this.hk.daylight = this.obj.state.daylight ? 1 : 0;
  }
  this.hk.lastupdated =
    (this.obj.state.lastupdated && this.obj.state.lastupdated !== 'none') ?
    String(new Date(this.obj.state.lastupdated + 'Z')).substring(0, 24) : 'n/a';
  this.hk.enabled = this.obj.config.on ? 1 : 0;
  if (!this.type.ignoreReachable) {
    this.hk.fault = this.obj.config.reachable ? 0 : 1;
  }
  if (this.obj.config.sensitivity !== undefined) {
    this.hk.sensitivity = this.obj.config.sensitivity;
    this.hk.duration = this.duration;
  }
  this.hk.battery = this.obj.config.battery ? this.obj.config.battery : 100;
  this.hk.lowBattery =
    this.hk.battery <= this.bridge.platform.config.lowBattery ?
    Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW :
    Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL;
  this.hk.charging = Characteristic.ChargingState.NOT_CHARGEABLE;
};

// ===== Bridge Events =========================================================

HueSensor.prototype.heartbeat = function(obj) {
  if (!this.service) {
    return;
  }
  const old = {
    obj: this.obj,
    value: this.value,
    hk: this.hk
  };
  this.obj = obj;
  this.refresh();
  if (this.type.key === 'buttonevent') {
    if (this.obj.state.lastupdated !== old.obj.state.lastupdated) {
      this.log.debug(
        '%s: sensor buttonevent %d on %s', this.name,
      	this.value, this.obj.state.lastupdated
      );
      const action = this.type.homekitAction(this.value, old.value);
      if (this.hk.value !== undefined && action !== undefined) {
        this.log.info(
          '%s: homekit button %s', this.serviceList[this.hk.value].displayName,
          {0: 'single press', 1: 'double press', 2: 'long press'}[action]
        );
        this.serviceList[this.hk.value]
          .updateCharacteristic(Characteristic.ProgrammableSwitchEvent, action);
      }
    }
  } else {
    if (this.value !== old.value) {
      this.log.debug(
        '%s: sensor %s changed from %s to %s on %s', this.name,
      	this.type.key, old.value, this.value, this.obj.state.lastupdated
      );
    }
    if (this.hk.value !== old.hk.value) {
      if (this.durationTimer) {
        clearTimeout(this.durationTimer);
        this.durationTimer = null;
      }
      if (this.duration > 0  && this.hk.value === 0) {
        this.log.debug(
          '%s: keep homekit %s on %s%s for %ds on %s', this.name,
          this.type.name, old.hk.value, this.type.unit, this.hk.duration,
          this.hk.lastupdated
        );
        const saved = {
          oldValue: old.hk.value,
          value: this.hk.value,
          duration: this.hk.duration,
          lastupdated: this.hk.lastupdated
        };
        this.durationTimer = setTimeout(function () {
          this.log.info(
            '%s: set homekit %s from %s%s to %s%s, %ds after %s',
            this.name, this.type.name, saved.oldValue, this.type.unit,
          	saved.value, this.type.unit, saved.duration, saved.lastupdated
          );
          this.durationTimer = null;
          this.service
            .updateCharacteristic(this.type.Characteristic, saved.value);
        }.bind(this), this.duration * 1000);
      } else {
        this.log.info(
          '%s: set homekit %s from %s%s to %s%s on %s', this.name,
        	this.type.name, old.hk.value, this.type.unit,
        	this.hk.value, this.type.unit, this.hk.lastupdated
        );
        this.service
          .updateCharacteristic(this.type.Characteristic, this.hk.value);
        }
    }
  }
  if (this.obj.state.dark !== old.obj.state.dark) {
    this.log.debug(
      '%s: sensor dark changed from %s to %s', this.name,
      old.obj.state.dark, this.obj.state.dark
    );
  }
  if (this.hk.dark !== old.hk.dark) {
    this.log.info(
      '%s: set homekit dark from %s to %s', this.name,
      old.hk.dark, this.hk.dark
    );
    this.service.updateCharacteristic(Characteristic.Dark, this.hk.dark);
  }
  if (this.obj.state.daylight !== old.obj.state.daylight) {
    this.log.debug(
      '%s: sensor daylight changed from %s to %s', this.name,
      old.obj.state.daylight, this.obj.state.daylight
    );
  }
  if (this.hk.daylight !== old.hk.daylight) {
    this.log.info(
      '%s: set homekit daylight from %s to %s', this.name,
      old.hk.daylight, this.hk.daylight
    );
    this.service
      .updateCharacteristic(Characteristic.Daylight, this.hk.daylight);
  }
  if (this.obj.config.sensitivity !== old.obj.config.sensitivity) {
    this.log.debug(
      '%s: sensor sensitivity changed from %s to %s', this.name,
      old.obj.config.sensitivity, this.obj.config.sensitivity
    );
  }
  if (this.obj.state.lastupdated !== old.obj.state.lastupdated) {
    this.service
      .updateCharacteristic(Characteristic.LastUpdated, this.hk.lastupdated);
  }
  if (this.obj.config.on !== old.obj.config.on) {
    this.log.debug(
      '%s: sensor on changed from %s to %s', this.name,
      old.obj.config.on, this.obj.config.on
    );
  }
  if (this.hk.enabled !== old.hk.enabled) {
    this.log.info(
      '%s: set homekit enabled from %s to %s', this.name,
      old.hk.enabled, this.hk.enabled
    );
    this.service
      .updateCharacteristic(Characteristic.Enabled, this.hk.enabled)
      .updateCharacteristic(Characteristic.StatusActive, this.hk.enabled);
  }
  if (
    !this.type.ignoreReachable &&
    this.obj.config.reachable !== undefined &&
    this.obj.config.reachable !== old.obj.config.reachable
  ) {
    this.log.debug(
      '%s: sensor reachable changed from %s to %s', this.name,
      old.obj.config.reachable, this.obj.config.reachable
    );
  }
  if (this.hk.fault !== old.hk.fault) {
    this.log.info(
      '%s: set homekit status fault from %s to %s', this.name,
      old.hk.fault, this.hk.fault
    );
    this.service
      .updateCharacteristic(Characteristic.StatusFault, this.hk.fault);
  }
  if (this.hk.sensitivity !== old.hk.sensitivity) {
    this.log.info(
      '%s: set homekit sensitivity from %s to %s', this.name,
      old.hk.sensitivity, this.hk.sensitivity
    );
    this.service
      .updateCharacteristic(Characteristic.Sensitivity, this.hk.sensitivity);
  }
  if (
    this.obj.config.battery !== undefined &&
    this.obj.config.battery != old.obj.config.battery
  ) {
    this.log.debug(
      '%s: sensor battery changed from %s to %s', this.name,
      old.obj.config.battery, this.obj.config.battery);
  }
  if (this.hk.battery !== old.hk.battery) {
    this.log.info(
      '%s: set homekit battery level from %s%% to %s%%', this.name,
      old.hk.battery, this.hk.battery
    );
    this.batteryService
      .updateCharacteristic(Characteristic.BatteryLevel, this.hk.battery)
      .updateCharacteristic(
        Characteristic.StatusLowBattery, this.hk.lowBattery
      );
  }
};

HueSensor.prototype.stateChangedEvent = function(state) {
  for (const key in state) {
    if (key === this.type.key) {
      const value = state[this.type.key];
      const hkvalue = this.type.homekitValue(value);
      if (key === 'buttonevent') {
        this.log.debug(
          '%s: event: sensor buttonevent %d', this.name, state.buttonevent
        );
        const action = this.type.homekitAction(state.buttonevent, this.value);
        if (hkvalue !== undefined && action !== undefined) {
          this.log.info(
            '%s: homekit button %s', this.serviceList[hkvalue].displayName,
            {0: 'single press', 1: 'double press', 2: 'long press'}[action]
          );
          this.serviceList[hkvalue]
            .updateCharacteristic(
              Characteristic.ProgrammableSwitchEvent, action
            );
        }
      } else {
        this.log.debug(
          '%s: event: sensor %s changed from %s to %s', this.name,
          this.type.key, this.value, value
        );
        if (value !== undefined && this.value !== value) {
          this.log.info(
            '%s: set homekit %s from %s%s to %s%s', this.name,
            this.type.name, this.hk.value, this.type.unit,
            hkvalue, this.type.unit
          );
          this.service
            .updateCharacteristic(this.type.Characteristic, hkvalue);
        }
      }
      this.value = value;
      this.hk.value = hkvalue;
    } else {
      switch (key) {
        case 'dark':
          if (state.dark != this.obj.state.dark) {
            this.log.debug(
              '%s: event: sensor dark changed from %s to %s', this.name,
              this.obj.state.dark, state.dark
            );
            this.obj.state.dark = state.dark;
          }
          const hkdark = this.obj.state.dark ? 1 : 0;
          if (hkdark != this.hk.dark) {
            this.log.info(
              '%s: set homekit dark from %s to %s', this.name,
              this.hk.dark, hkdark
            );
            this.hk.dark = hkdark;
            this.service
              .updateCharacteristic(Characteristic.Dark, this.hk.dark);
          }
          break;
        case 'daylight':
          if (state.daylight !== this.obj.state.daylight) {
            this.log.debug(
              '%s: event: sensor daylight changed from %s to %s', this.name,
              this.obj.state.daylight, state.daylight
            );
            this.obj.state.daylight = state.daylight;
          }
          const hkdaylight = this.obj.state.daylight ? 1 : 0;
          if (hkdaylight !== this.hk.daylight) {
            this.log.info(
              '%s: set homekit daylight from %s to %s', this.name,
              this.hk.daylight, hkdaylight
            );
            this.hk.daylight = hkdaylight;
            this.service
              .updateCharacteristic(Characteristic.Daylight, this.hk.daylight);
          }
          break;
        case 'lastupdated':
          if (state.lastupdated !== this.obj.state.lastupdated) {
            const hklastupdated =
              (state.lastupdated && state.lastupdated !== 'none') ?
              String(new Date(state.lastupdated + 'Z')).substring(0, 24) :
              'n/a';
            this.obj.state.lastupdated = state.lastupdated;
            this.hk.lastupdated = hklastupdated;
            this.service
              .updateCharacteristic(Characteristic.LastUpdated, hklastupdated);
          }
          break;
        case 'lux':
          break;
        default:
          this.log.debug(
            '%s: ignore unknown attribute state.%s', this.name, key
          );
          break;
      }
    }
  }
};

HueSensor.prototype.configChangedEvent = function(config) {
  for (const key in config) {
    switch (key) {
      case 'alert':
        break;
      case 'battery':
        if (config.battery != this.obj.config.battery) {
          this.log.debug(
            '%s: event: sensor battery changed from %s to %s', this.name,
            this.obj.config.battery, config.battery
          );
          this.obj.config.battery = config.battery;
        }
        const hkbattery = config.battery;
        if (hkbattery !== this.hk.battery) {
          this.log.info(
            '%s: set homekit battery level from %s%% to %s%%', this.name,
            this.hk.battery, hkbattery
          );
          this.hk.battery = hkbattery;
          this.hk.lowBattery =
            this.hk.battery <= this.bridge.platform.config.lowBattery ?
            Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW :
            Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL;
          this.batteryService
            .updateCharacteristic(
              Characteristic.BatteryLevel, this.hk.battery
            )
            .updateCharacteristic(
              Characteristic.StatusLowBattery, this.hk.lowBattery
            );
        }
        break;
      case 'duration':
        break;
      case 'group':
        break;
      case 'ledindication':
        break;
      case 'on':
        if (config.on !== this.obj.config.on) {
          this.log.debug(
            '%s: event: sensor on changed from %s to %s', this.name,
            this.obj.config.on, config.on
          );
          this.obj.config.on = config.on;
        }
        const hkenabled = config.on ? 1 : 0;
        if (hkenabled !== this.hk.enabled) {
          this.log.info(
            '%s: set homekit enabled from %s to %s', this.name,
            this.hk.enabled, hkenabled
          );
          this.hk.enabled = hkenabled;
          this.service
            .updateCharacteristic(Characteristic.Enabled, this.hk.enabled)
            .updateCharacteristic(Characteristic.StatusActive, this.hk.enabled);
        }
        break;
      case 'reachable':
        if (this.type.ignoreReachable) {
          continue;
        }
        if (config.reachable !== this.obj.config.reachable) {
          this.log.debug(
            '%s: event: sensor reachable changed from %s to %s', this.name,
            this.obj.config.reachable, config.reachable
          );
          this.obj.config.reachable = config.reachable;
        }
        const hkfault = this.obj.config.reachable ? 0 : 1;
        if (hkfault !== this.hk.fault) {
          this.log.info(
            '%s: set homekit status fault from %s to %s', this.name,
            this.hk.fault, hkfault
          );
          this.hk.fault = hkfault;
          this.service
            .updateCharacteristic(Characteristic.StatusFault, this.hk.fault);
        }
        break;
      case 'sensitivity':
        if (config.sensitivity !== this.obj.config.sensitivity) {
          this.log.debug(
            '%s: event: sensor sensitivity changed from %s to %s', this.name,
            this.obj.config.sensitivity, config.sensitivity
          );
          this.obj.config.sensitivity = config.sensitivity;
        }
        const hksensitivity = config.sensitivity;
        if (hksensitivity !== this.hk.sensitivity) {
          this.log.info(
            '%s: set homekit sensitivity from %s to %s', this.name,
            this.hk.sensitivity, hksensitivity
          );
          this.hk.sensitivity = hksensitivity;
          this.service
            .updateCharacteristic(
              Characteristic.Sensitivity, this.hk.sensitivity
            );
        }
        break;
      case 'sensitivitymax':
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

// ===== Homekit Events ========================================================

HueSensor.prototype.identify = function(callback) {
  this.log.info('%s: identify', this.name);
  if (this.obj.config.alert === undefined) {
    return callback();
  }
  this.bridge.request('put', this.resource + '/config', {alert: 'select'})
  .then(function(obj) {
    return callback();
  }.bind(this))
  .catch(function(err) {
    return callback(new Error(err));
  }.bind(this));
};

HueSensor.prototype.setValue = function(value, callback) {
  if (value === this.hk.value) {
    return callback();
  }
  this.log.info(
    '%s: homekit %s changed from %s%s to %s%s', this.name,
    this.type.name,	this.hk.value, this.type.unit, value, this.type.unit
  );
  this.hk.value = value;
  const newValue = this.type.bridgeValue(value);
  const body = {};
  body[this.type.key] = newValue;
  this.bridge.request('put', this.resource + '/state', body)
  .then(function(obj) {
    this.obj.state[this.type.key] = newValue;
    this.value = newValue;
    return callback();
  }.bind(this))
  .catch(function(err) {
    return callback(new Error(err));
  }.bind(this));
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
  .then(function(obj) {
    this.obj.config.on = on;
    this.service
      .updateCharacteristic(Characteristic.StatusActive, this.hk.enabled);
    return callback();
  }.bind(this))
  .catch(function(err) {
    return callback(new Error(err));
  }.bind(this));
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
  .then(function(obj) {
    this.obj.config.sensitivity = sensitivity;
    return callback();
  }.bind(this))
  .catch(function(err) {
    return callback(new Error(err));
  }.bind(this));
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
  this.duration = duration;
  return callback();
};
