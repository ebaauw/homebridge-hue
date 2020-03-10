// homebridge-hue/lib/HueDiscovery.js
//
// Homebridge plug-in for Philips Hue and/or deCONZ.
// Copyright © 2018-2020 Erik Baauw. All rights reserved.
//
// Discovery of Hue API servers.

'use strict'

const debug = require('debug')
const events = require('events')
const homebridgeLib = require('homebridge-lib')

let id = 0

class HueDiscovery {
  constructor (options = {}) {
    this._debug = debug('HueDiscovery' + ++id)
    this._debug('constructor(%j)', options)
    this._options = {
      forceHttp: false,
      timeout: 5,
      nupnp: true
    }
    const optionParser = new homebridgeLib.OptionParser(this._options)
    optionParser.boolKey('forceHttp')
    optionParser.intKey('timeout', 1, 60)
    optionParser.boolKey('nupnp')
    optionParser.boolKey('verbose')
    optionParser.parse(options)
    this._debug('constructor(%j) => %j', options, this._options)
  }

  async discover () {
    this.bridgeMap = {}
    await Promise.all([
      this._upnp(),
      this._nupnp('meethue', {
        https: !this._options.forceHttp,
        host: 'discovery.meethue.com'
      }),
      this._nupnp('deconz', {
        https: !this._options.forceHttp,
        host: 'phoscon.de',
        path: '/discover'
      })
    ])
    return this.bridgeMap
  }

  async _upnp () {
    if (this._options.verbose) {
      this.bridgeMap.upnp = {}
    }
    const upnpClient = new homebridgeLib.UpnpClient({
      filter: (message) => {
        return /^[0-9A-F]{16}$/.test(message['hue-bridgeid'])
      },
      timeout: this._options.timeout
    })
    upnpClient.on('deviceFound', (address, obj, message) => {
      const id = obj['hue-bridgeid']
      const location = obj.location
      let host
      const a = location.split('/')
      if (a.length > 3 && a[2] != null) {
        host = a[2]
        const b = host.split(':')
        const port = parseInt(b[1])
        if (port === 80) {
          host = b[0]
        }
        this._debug('upnp: found %s at %s', id, host)
        if (this._options.verbose) {
          this.bridgeMap.upnp[host] = id
        } else {
          this.bridgeMap[host] = id
        }
      }
    })
    upnpClient.on('searching', () => { this._debug('upnp searching') })
    upnpClient.on('error', (error) => { this._debug('upnp error %s', error) })
    upnpClient.search()
    await events.once(upnpClient, 'searchDone')
  }

  async _nupnp (name, options) {
    if (!this._options.nupnp) {
      return
    }
    if (this._options.verbose) {
      this.bridgeMap[name] = {}
    }
    options.json = true
    options.timeout = this._options.timeout
    const client = new homebridgeLib.HttpClient(options)
    try {
      const { body } = await client.get()
      if (Array.isArray(body)) {
        for (const bridge of body) {
          let host = bridge.internalipaddress
          if (bridge.internalport != null && bridge.internalport !== 80) {
            host += ':' + bridge.internalport
          }
          const id = bridge.id.toUpperCase()
          this._debug('%s: found %s at %s', name, id, host)
          if (this._options.verbose) {
            this.bridgeMap[name][host] = id
          } else {
            this.bridgeMap[host] = id
          }
        }
      }
    } catch (error) {
      this._debug('%s: %s', name, error.message)
    }
  }
}

module.exports = HueDiscovery
