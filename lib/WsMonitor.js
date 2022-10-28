// homebridge-hue/lib/WsMonitor.js
//
// Homebridge plug-in for Philips Hue and/or deCONZ.
// Copyright © 2018-2022 Erik Baauw. All rights reserved.

'use strict'

const events = require('events')
const homebridgeLib = require('homebridge-lib')
const WebSocket = require('ws')

/** Client for deCONZ web socket notifications.
  *
  * See the
  * [deCONZ](https://dresden-elektronik.github.io/deconz-rest-doc/endpoints/websocket/)
  * documentation for a better understanding of the web socket notifications.
  * @copyright © 2018-2021 Erik Baauw. All rights reserved.
  */
class WsMonitor extends events.EventEmitter {
  /** Create a new web socket client instance.
    * @param {object} params - Parameters.
    * @param {string} [params.host='localhost:443'] - IP address or hostname
    * and port of the web socket server.
    * @param {integer} [params.retryTime=10] - Time (in seconds) to try and
    * reconnect when the server connection has been closed.
    * @param {boolean} [params.raw=false] - Issue raw events instead of parsing
    * them.<br>
    * When specified, {@link WsMonitor#event:notification notification}
    * events are emitted, in lieu of {@link WsMonitor#event:changed changed},
    * {@link WsMonitor#event:added added}, and
    * {@link WsMonitor#event:sceneRecall sceneRecall} events.
    */
  constructor (params = {}) {
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
    optionParser.parse(params)
  }

  /** Listen for web socket notifications.
    */
  listen () {
    const url = 'ws://' + this._options.hostname + ':' + this._options.port
    this.ws = new WebSocket(url, { family: 4 })

    this.ws
      .on('error', (error) => {
        /** Emitted on error.
          * @event WsMonitor#error
          * @param {Error} error - The error.
          */
        this.emit('error', error)
      })
      .on('open', () => {
        /** Emitted when connection to web socket server is opened.
          * @event WsMonitor#listening
          * @param {string} url - The URL of the web socket server.
          */
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
                    /** Emitted when a `changed` notification has been received.
                      * @event WsMonitor#changed
                      * @param {string} resource - The changed resource.<br>
                      * This can be a `/lights`, `/groups`, or `/sensors`
                      * resource for top-level attributes, or a `state` or
                      * `config` sub-resource.
                      * @param {object} attributes - The top-level, `state`, or
                      * `config` attributes.
                      */
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
                  break
                case 'added':
                  if (obj.r && obj.id) {
                    const resource = '/' + obj.r + '/' + obj.id
                    /** Emitted when an `added` notification has been received.
                      * @event WsMonitor#added
                      * @param {string} resource - The added resource.
                      * @param {object} attributes - The full attributes of the
                      * added resource.
                      */
                    this.emit('added', resource, obj[obj.r.slice(0, -1)])
                    return
                  }
                  break
                case 'scene-called':
                  if (obj.gid && obj.scid) {
                    const resource = '/groups/' + obj.gid + '/scenes/' + obj.scid
                    /** Emitted when an `sceneRecall` notification has been received.
                      * @event WsMonitor#sceneRecall
                      * @param {string} resource - The scene resource.
                      */
                    this.emit('sceneRecall', resource)
                    return
                  }
                  break
                default:
                  break
              }
            }
          }
          /** Emitted when an unknown notification has been received, or when
            * `params.raw` was specified to the
            * {@link WsMonitor constructor}.
            * @event WsMonitor#notification
            * @param {object} notification - The raw notification.
            */
          this.emit('notification', obj)
        } catch (error) {
          this.emit('error', error)
        }
      })
      .on('close', () => {
        /** Emitted when the connection to the web socket server has been closed.
          * @event WsMonitor#closed
          * @param {string} url - The URL of the web socket server.
          */
        this.emit('closed', url)
        if (this._options.retryTime > 0) {
          setTimeout(this.listen.bind(this), this._options.retryTime * 1000)
        }
      })
  }

  /** Close the websocket.
    */
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
