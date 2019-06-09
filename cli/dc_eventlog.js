#!/usr/bin/env node

// homebridge-hue/cli/dc_eventlog.js
//
// Homebridge plug-in for Philips Hue and/or deCONZ.
// Copyright © 2018-2019 Erik Baauw. All rights reserved.
//
// Logger for deCONZ websocket notifications.

'use strict'

const chalk = require('chalk')
const homebridgeLib = require('homebridge-lib')
const WsMonitor = require('../lib/WsMonitor')
const packageJson = require('../package.json')

const b = chalk.bold
const u = chalk.underline
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
  }

  parseArguments () {
    const parser = new homebridgeLib.CommandLineParser(packageJson)
    parser.help('h', 'help', help)
    parser.version('V', 'version')
    parser.option('H', 'host', (value) => {
      homebridgeLib.OptionParser.toHost(value, true)
      this.ws.host = value
    })
    parser.flag('n', 'noretry', () => { this.ws.retryTime = 0 })
    parser.flag('r', 'raw', () => { this.ws.raw = true })
    parser.flag('s', 'service', () => { this.options.mode = 'service' })
    parser.parse()
  }

  exit (signal) {
    this.log('got %s - exiting', signal)
    process.exit(0)
  }

  main () {
    try {
      this.parseArguments()
      const wsMonitor = new WsMonitor(this.ws)
      this.jsonFormatter = new homebridgeLib.JsonFormatter(
        this.options.mode === 'service' ? { noWhiteSpace: true } : {}
      )
      process.on('SIGINT', () => { this.exit('SIGINT') })
      process.on('SIGTERM', () => { this.exit('SIGTERM') })
      wsMonitor.on('listening', (url) => { this.log('listening on %s', url) })
      wsMonitor.on('closed', () => { this.log('connection closed') })
      wsMonitor.on('error', (err) => { this.error(err) })
      wsMonitor.on('changed', (resource, body) => {
        this.log('%s: %s', resource, this.jsonFormatter.stringify(body))
      })
      wsMonitor.on('added', (resource, body) => {
        this.log('%s: %s', resource, this.jsonFormatter.stringify(body))
      })
      wsMonitor.on('sceneRecall', (resource) => {
        this.log('%s: recall', resource)
      })
      wsMonitor.on('notification', (body) => {
        this.log(this.jsonFormatter.stringify(body))
      })
      this.setOptions({ mode: this.options.mode })
      wsMonitor.listen()
    } catch (err) {
      this.fatal(err)
    }
  }
}

new Main().main()
