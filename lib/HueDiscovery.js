// homebridge-hue/lib/HueDiscovery.js
//
// Homebridge plug-in for Philips Hue and/or deCONZ.
// Copyright © 2018-2020 Erik Baauw. All rights reserved.
//
// Discovery of Hue API servers.

'use strict'

const debug = require('debug')
const homebridgeLib = require('homebridge-lib')

let id = 0

class HueDiscovery {
  constructor (options = {}) {
    this._debug = debug('HueDiscovery' + ++id)
    this._debug('constructor(%j)', options)
    this._options = {
      timeout: 5
    }
    const optionParser = new homebridgeLib.OptionParser(this._options)
    optionParser.boolKey('verbose')
    optionParser.intKey('timeout', 1, 60)
    optionParser.parse(options)
    this._debug('constructor(%j) => %j', options, this._options)
  }

  async discover () {
    this.bridgeMap = {}
    return Promise.all([
      this._upnp(),
      this._nupnp({
        https: true,
        host: 'discovery.meethue.com',
        name: 'meethue'
      }),
      this._nupnp({
        host: 'phoscon.de',
        name: 'deconz4',
        path: 'discover'
      }),
      this._nupnp({
        https: true,
        host: 'www.meethue.com',
        name: 'meethueOld',
        path: '/api/nupnp'
      }),
      this._nupnp({
        host: 'dresden-light.appspot.com',
        name: 'deconz4Old',
        path: 'discover'
      }),
      this._nupnp({
        host: 'dresden-light.appspot.com',
        ipv6: true,
        name: 'deconz6Old',
        path: 'discover'
      })
    ]).then(() => {
      return this.bridgeMap
    })
  }

  async _upnp () {
    if (this._options.verbose) {
      this.bridgeMap.upnp = {}
    }
    return new Promise((resolve, reject) => {
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
      upnpClient.on('searchDone', () => { resolve() })
      upnpClient.on('error', (error) => { reject(error) })
      upnpClient.search()
    })
  }

  async _nupnp (options) {
    if (this._options.verbose) {
      this.bridgeMap[options.name] = {}
    }
    options.timeout = this._options.timeout
    const client = new homebridgeLib.RestClient(options)
    return client.get().then((response) => {
      if (Array.isArray(response)) {
        for (const bridge of response) {
          let host = bridge.internalipaddress
          if (bridge.internalport != null && bridge.internalport !== 80) {
            host += ':' + bridge.internalport
          }
          const id = bridge.id.toUpperCase()
          this._debug('%s: found %s at %s', options.name, id, host)
          if (this._options.verbose) {
            this.bridgeMap[options.name][host] = id
          } else {
            this.bridgeMap[host] = id
          }
        }
      }
    }).catch((error) => { this._debug('%s: %s', options.name, error.message) })
  }
}

module.exports = HueDiscovery
