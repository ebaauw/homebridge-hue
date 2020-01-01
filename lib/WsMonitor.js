// homebridge-hue/lib/WsMonitor.js
//
// Homebridge plug-in for Philips Hue and/or deCONZ.
// Copyright © 2018-2020 Erik Baauw. All rights reserved.
//
// Monitor for deCONZ websocket notifications.

'use strict'

const events = require('events')
const homebridgeLib = require('homebridge-lib')
const WebSocket = require('ws')

module.exports = class WsMonitor extends events.EventEmitter {
  constructor (options = {}) {
    super()
    this._options = {
      hostname: 'localhost',
      port: 443,
      retryTime: 10
    }
    const optionParser = new homebridgeLib.OptionParser(this._options)
    optionParser.hostKey()
    optionParser.intKey('retryTime', 0, 120)
    optionParser.boolKey('raw')
    optionParser.parse(options)
  }

  listen () {
    const url = 'ws://' + this._options.hostname + ':' + this._options.port
    const ws = new WebSocket(url)

    ws.on('open', () => {
      this.emit('listening', url)
    })

    ws.on('message', (data, flags) => {
      try {
        const obj = JSON.parse(data)
        if (!this._options.raw) {
          if (obj.t === 'event') {
            switch (obj.e) {
              case 'changed':
                if (obj.r && obj.id && obj.state) {
                  const resource = '/' + obj.r + '/' + obj.id + '/state'
                  this.emit('changed', resource, obj.state)
                  return
                }
                if (obj.r && obj.id && obj.config) {
                  const resource = '/' + obj.r + '/' + obj.id + '/config'
                  this.emit('changed', resource, obj.config)
                  return
                }
                break
              case 'added':
                if (obj.r && obj.id) {
                  const resource = '/' + obj.r + '/' + obj.id
                  this.emit('added', resource, obj[obj.r.slice(0, -1)])
                  return
                }
                break
              case 'scene-called':
                if (obj.gid && obj.scid) {
                  const resource = '/groups/' + obj.gid + '/scenes/' + obj.scid
                  this.emit('sceneRecall', resource)
                  return
                }
                break
              default:
                this.emit('notification', obj)
                break
            }
          }
        }
        this.emit('notification', obj)
      } catch (err) {
        this.emit('error', err)
      }
    })

    ws.on('error', (error) => {
      this.emit('error', error)
    })

    ws.on('close', () => {
      this.emit('closed')
      if (this._options.retryTime > 0) {
        setTimeout(this.listen.bind(this), this._options.retryTime * 1000)
      }
    })
  }
}
