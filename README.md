# homebridge-hue
(C) 2016, Erik Baauw

Homebridge plug-in for Philips Hue.

This plug-in exposes Philips Hue bridge lights, groups, sensors, and schedules to Apple's Homekit.  Each supported Hue bridge resource is mapped to a corresponding Homekit accessory, with an appropriate service to match the resource type, and an accessory information service.  Each supported Hue bridge resource field is then mapped to a corresponding Homekit characteristic.

As the Philips Hue API does not support notifications for changes to the Hue bridge state, homebridge-hue polls the Hue bridge state at a regular interval, specified as `heartrate` in `config.json`.  For each Hue bridge field changed, homebridge-hue updates the corresponding Homekit characteristic.  Homekit (through homebridge) does notify homebridge-hue of any changes to Homekit characteristic values.  For each change, homebridge-hue updates the corresponding field in the Hue bridge.

The homebridge-hue plug-in outputs an info message for each Homekit characteristic value it sets and for each Homekit characteristic value change notification it receives.  When homebridge is started with `-D`, homebridge-hue outputs a debug message for each request it makes to the Hue bridge and for each Hue bridge state change it detects.

## Bridges
The homebridge-hue plug-in tries to discover any Hue bridge on your network by querying the Meethue portal.  It creates a Homekit accessory for each bridge, with only an accessory information service.  Alternatively, the bridge's hostname or IP address can be specified in `config.json`.

Note that homebridge-hue does not yet support creating a Hue bridge user.  For now, the user must be created manually and the username must be specified in `config.json`.  While homebridge-hue supports multiple bridges, it does not yet support a username per bridge.  In other words: the same username is used for each bridge.  Unfortunately, the latest version of the Philips Hue API no longer supports specifying the username when creating a new user.

## Lights
A Hue bridge light is exposed as a Homekit accessory with a `Lightbulb` service, with characteristics for `On`, `Brightness`, `Hue`, `Saturation`, and `Color Temperature`, depending on the light's features.  Note that `Color Temperature` is a custom characteristic, which might not be supported by all Homekit apps.  It holds the light's colour temperature in Kelvin, from `2000` to `6540`.

By default homebridge-hue exposes only non-Philips lights, which are not exposed to Homekit by the v2 (square) Hue Bridge.  You might want to change this in `config.json` if you have a v1 (round) bridge, or if you want to use the `Color Temperature` charateristic.

## Groups
A Hue bridge group is exposed as a Homekit accessory with `Lightbulb` service and appropriate characteristics, just as a light.
By default, homebridge-hue does not expose groups.  You might want to change this in `config.json` if you want to use Hue group commands from Homekit scenes.

Note that `group 0` is not yet supported, due to technical reasons.  Also groups of type `Room` are ignored for now - there should probably be a setting to change this.

## Sensors
A Hue bridge sensor is exposed as a Homekit accessory with the appropriate service and corresponding characteristic:

- A Hue Tap switch (`ZGPSwitch` sensor) is exposed as a `Stateful Programmable Switch` service.  The `Output State` holds the number of the button pressed, `1`, `2`, `3`, or `4`.
- A Hue Dimmer switch (`ZLLSwitch` sensor) is exposed as a `Stateful Programmable Switch`.  The `Output State` holds the number of the button pressed, `1` (On), `2` (Dim Up), `3` (Dim Down), or `4` (Off).  Note that as homebridge-hue cannot reliably detect all dimmer button events as it polls the Hue bridge.  Consequently, homebridge-hue only supports the release button events.
- The Hue bridge actually creates three sensors per Hue Motion Sensor, each of which is exposed as a separate Homekit accessory with the approrpiate service: a `Motion Sensor` for the `ZLLPresence` sensor, a `Light Sensor` for the `ZLLLightLevel` sensor and a `Temperature Sensor` for the `ZLLTemperature` sensor.  This probably should have been one accessory with three services.  Note that the `dark` and `daylight` attributes in the `ZLLLightLevel` sensor `state` are not supported.
- The built-in Daylight sensor is exposed a as a `Stateful Programmable Switch` service.  I tried exposing this sensor as a regular `Switch` using a read-only `On` characteristic, but the iOS 10 `Home` app ignores the read-only setting.  The `Output State` holds `0` (`false`) or `1` (`true`).  Exposing this sensor was particularly cool under iOS 9, when Homekit didn't yet support rules on sunrise and sunset.  Under iOS 10 it does, even though most 3rd-party Homekit apps don't yet support this.
- A `CLIPGenericFlag` sensor is exposed as a `Switch` service, with an `On` characteristic.
- A `CLIPGenericStatus` sensor is exposed as a `Stateful Programmable Switch` service.  The `Output State` holds the `status`, limited to values from `0` to `255`, as it's next to impossible to set a precise value using a slider in the full `int32` range.
- I haven't tested any Other CLIP sensors, but they are be exposed as well.

Additionally for each sensor, a custom `Last Updated` characteristic is provided, and, where appropriate, `Battery Level` and `Status Active` characteristics for the sensor's `config` attributes `battery` and `on`.  Note that enabling or disabling the sensor from Homekit is not supported, as `Status Active` is read-only.

By default homebridge-hue does not expose sensors.  You want to change this in `config.json`, so the sensors can be used as triggers and/or conditions in Homekit rules.

## Schedules
A Hue bridge schedule is exposed as a Homekit `Switch`.

By default, homebridge-hue does not expose schedules.  You might want to change this in `config.json`, to enable or disable schedules from Homekit.

## Installation
The homebridge-hue plug-in obviously needs homebridge, which, in turn needs Node.js.  I've followed the following steps to set it up on my macOS server:

- Install the Node.js JavaScript runtime `node`, from `https://nodejs.org`.  I'm using v4.6.1 LTS for macOS (x64), which includes the `npm` package manager.
- Make sure `/usr/local/bin` is in your `$PATH`, as `node`, `npm`, and, later, `homebridge` install there.
- You might want to update `npm` through `sudo npm install npm@3.10.7 -g`.  The latest version, 3.10.8, causes issues, so I use 3.10.7.
- Install homebridge following the instructions on `https://github.com/nfarina/homebridge`.  For me, this installs homebridge version 0.4.6 to `/usr/local/lib/node_modules`.  Make sure to create a `config.json` in `~/.homebridge`, as described.
- Install the homebridge-hue plug-in through `npm install homebridge-hue -g`.
- If you don't already have one, create a Hue bridge username using the CLIP API Debugger, as described on `http://www.developers.meethue.com/documentation/getting-started`.
- Edit `~/homebridge/config.json` and add the `Hue` platform provided by homebridge-hue, see below.  Be sure to set the `host` and `user` parameters.

Once homebridge is up and running with the homebridge-hue plug-in, you might want to daemonise it and start it automatically.  For macOS, I've provided an example `launchd` configuration in `org.nodejs.homebridge.plist`.  Make sure to edit this file and change `ebaauw` to match your username and `$HOME` directory.  Load the agent through `launchctl load org.nodejs.homebridge.plist` and check that homebridge is started and logging to the right logfile.  Once you're happy, copy the edited `org.nodejs.homebridge.plist` to `~/Library/LaunchAgents`, to start homebridge automatically on login, or to `/Library/LaunchDaemons` to start it automatically on system boot.

## Configuration
In homebridge's `config.json` you need to specify a platform for homebridge-hue:
```
  "platforms": [
    {
      "platform": "Hue",
      "name": "Hue",
      "host": "...",
      "user": "...",
      "heartrate": 5,
      "timeout": 5,
      "lights": true,
      "groups": true,
      "sensors": true,
      "schedules": true
    }
  ]
``
The following parameters modify homebridge-hue's behaviour:

- `host`: The hostname or IP address of the Hue bridge.  Default: empty, discover the bridge by querying the Meethue portal;
- `user`: The Hue bridge username, effectively a security token to access the Hue bridge.  For now, this must be created manually and specified in `config.json`;
- `heartrate`: The interval in seconds to poll the Hue bridge.  Default: `5`.  I've been using a 2-second heartrate with no issues on my v2 (square) bridge;
- `timeout`: The timeout in seconds to wait for a response from the Hue bridge (or Meethue portal).  Default: `5`;
- `lights`: Flag whether to expose Hue bridge lights to Homekit.  Default: `false`, only expose non-Philips lights;
- `groups`: Flag whether to expose Hue bridge groups to Homekit.  Default: `false`;
- `sensors`: Flag whether to expose Hue bridge sensors to Homekit.  Default: `false`;
- `schedules`: Flag whether to expose Hue bridge schedules to Homekit.  Default: `false`.

## Caveats
- The homebridge-hue plug-in is a hobby project of mine, provided as-is, with no warranty whatsoever.  I've been running it successfully at my home for months, but your mileage might vary.  Please report any issues on GitHub.
- Homebridge is a great platform, but not really intented for consumers.
- Homekit is still relatively new, and the iOS 10 built-in `Home` app provides only limited support.  You might want to check some other homekit apps, like Elgato's `Eve` (free), Matthias Hochgatterer's `Home`, or, if you use `XCode`, Apple's `HMCatalog` example app.
- The Homekit terminology needs some getting used to.  An _accessory_ more or less corresponds to a physical device, accessible from your iOS device over WiFi or Bluetooth.  A _bridge_ (like homebridge) provides access to multiple bridged accessories.  An accessory might provide multiple _services_.  Each service corresponds to a virtual device (like a `Lightbulb`, `Switch`, `Motion Sensor`, ...).  There is also an accessory information service.  Siri interacts with services, not with accessories.  A service contains one or more _characteristics_.  A characteristic is like a service attribute, which might be read or written by homekit apps.  You might want to checkout Apple's `Homekit Accessory Simulator`, which is distributed a an additional tool for `XCode`.
- Homekit only seems to support 100 accessories per Homekit bridge (i.e. homebridge, not the Philips Hue bridge).  When homebridge exposes more accessories, Homekit refuses to pair to homebridge or unpairs itself from homebridge if it was paired already.
- Internally, homekit identifies services by UUID.  The homebridge-hue plug-in bases this UUID on the Hue bridge resource URI (e.g. `/sensors/1`), not on the resource name (e.g. `Daylight`).  This way, homebridge-hue can deal with duplicate names between lights, groups, sensors, schedules.  In addition, Homekit will still recognise the service after the resource name has changed on the Hue bridge, remembering which Homekit room, scenes, schedules, and rules it belonged to.  However, when a Hue bridge resource is deleted and then re-created, resulting in a different URI, Homekit will not recognise the new service, and you need to re-add the new service to any Homekit rooms, scenes, schedules, and rules.
