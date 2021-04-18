'use strict';
require('dotenv').config('')
const express = require('express')
const cors = require('cors')
const mountRoutes = require('./routes')

// Constants
const PORT = 8080;
const HOST = '0.0.0.0';
const allowedOrigins = [
  'https://raywallet.io',
  'http://localhost:3000',
]

// App
const app = express();

app.use(cors({
  origin: function (origin, callback) {
    if (!origin) return callback(null, true)
    if (allowedOrigins.indexOf(origin) === -1) {
      var msg = 'The CORS policy for this site does not ' +
        'allow access from the specified Origin.'
      return callback(new Error(msg), false)
    }
    return callback(null, true)
  }
}))

mountRoutes(app)

app.listen(PORT, HOST);
console.log(`Running on http://${HOST}:${PORT}`);
