#!/usr/bin/env node

// homebridge-hue/cli/dc_eventlog.js
//
// Homebridge plug-in for Philips Hue and/or deCONZ.
// Copyright © 2018-2021 Erik Baauw. All rights reserved.
//
// Logger for deCONZ websocket notifications.

'use strict'

const homebridgeLib = require('homebridge-lib')
const WsMonitor = require('../lib/WsMonitor')
const packageJson = require('../package.json')

const { b, u } = homebridgeLib.CommandLineTool

const usage = `${b('dc_eventlog')} [${b('-hVnrs')}] [${b('--host=')}${u('hostname')}[${b(':')}${u('port')}]]`
const help = `Logger for deCONZ websocket notifications.

Usage: ${usage}

Log deCONZ websocket notifications to stdout.
Parameters:
  ${b('-h')}          Print this help and exit.
  ${b('-V')}          Print version and exit.
  ${b('-n')}          Do not retry when websocket connection is closed.
  ${b('-r')}          Do not parse events, output raw event data.
  ${b('-s')}          Do not output timestamps (useful when running as service).
  ${b('-H')} ${u('hostname')}[${b(':')}${u('port')}]
              Connect to ${u('hostname')}${b(':')}${u('port')} instead of the default ${b('localhost:443')}.`

class Main extends homebridgeLib.CommandLineTool {
  constructor () {
    super()
    this.usage = usage
    this.options = {
      mode: 'daemon'
    }
    this.ws = {}
    if (process.env.PH_HOST != null) {
      this.ws.host = process.env.PH_HOST
    }
  }

  parseArguments () {
    const parser = new homebridgeLib.CommandLineParser(packageJson)
    parser
      .help('h', 'help', help)
      .version('V', 'version')
      .option('H', 'host', (value) => {
        homebridgeLib.OptionParser.toHost('host', value, false, true)
        this.ws.host = value
      })
      .flag('n', 'noretry', () => { this.ws.retryTime = 0 })
      .flag('r', 'raw', () => { this.ws.raw = true })
      .flag('s', 'service', () => { this.options.mode = 'service' })
      .parse()
  }

  async destroy () {
    if (this.wsMonitor == null) {
      return
    }
    await this.wsMonitor.close()
  }

  main () {
    try {
      this.parseArguments()
      this.wsMonitor = new WsMonitor(this.ws)
      this.jsonFormatter = new homebridgeLib.JsonFormatter(
        this.options.mode === 'service' ? { noWhiteSpace: true } : {}
      )
      this.setOptions({ mode: this.options.mode })
      this.wsMonitor
        .on('error', (error) => { this.error(error) })
        .on('listening', (url) => { this.log('listening on %s', url) })
        .on('closed', () => { this.log('connection closed') })
        .on('changed', (resource, body) => {
          this.log('%s: %s', resource, this.jsonFormatter.stringify(body))
        })
        .on('added', (resource, body) => {
          this.log('%s: %s', resource, this.jsonFormatter.stringify(body))
        })
        .on('sceneRecall', (resource) => {
          this.log('%s: recall', resource)
        })
        .on('notification', (body) => {
          this.log(this.jsonFormatter.stringify(body))
        })
        .listen()
    } catch (error) {
      this.fatal(error)
    }
  }
}

new Main().main()
