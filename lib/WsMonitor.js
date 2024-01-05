// homebridge-hue/lib/WsMonitor.js
//
// Homebridge plug-in for Philips Hue.
// Copyright © 2018-2024 Erik Baauw. All rights reserved.

'use strict'

const events = require('events')
const { OptionParser } = require('homebridge-lib')
const WebSocket = require('ws')

class WsMonitor extends events.EventEmitter {
  constructor (params = {}) {
    super()
    this._options = {
      hostname: 'localhost',
      port: 443,
      retryTime: 10
    }
    const optionParser = new OptionParser(this._options)
    optionParser.hostKey()
    optionParser.intKey('retryTime', 0, 120)
    optionParser.boolKey('raw')
    optionParser.parse(params)
  }

  listen () {
    const url = 'ws://' + this._options.hostname + ':' + this._options.port
    this.ws = new WebSocket(url, { family: 4 })

    this.ws
      .on('error', (error) => {
        this.emit('error', error)
      })
      .on('open', () => {
        this.emit('listening', url)
      })
      .on('message', (data, flags) => {
        try {
          const obj = JSON.parse(data.toString())
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
                  if (obj.r && obj.id && obj.attr) {
                    const resource = '/' + obj.r + '/' + obj.id
                    this.emit('changed', resource, obj.attr)
                    return
                  }
                  if (obj.r && obj.id && obj.capabilities) {
                    const resource = '/' + obj.r + '/' + obj.id + '/capabilities'
                    this.emit('changed', resource, obj.capabilities)
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
                  break
              }
            }
          }
          this.emit('notification', obj)
        } catch (error) {
          this.emit('error', error)
        }
      })
      .on('close', () => {
        this.emit('closed', url)
        if (this._options.retryTime > 0) {
          setTimeout(this.listen.bind(this), this._options.retryTime * 1000)
        }
      })
  }

  async close () {
    if (this.ws != null) {
      this.ws.close()
      await events.once(this.ws, 'close')
      this.ws.removeAllListeners()
      delete this.ws
    }
  }
}

module.exports = WsMonitor
