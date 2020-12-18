/* eslint-disable no-console */

import https from 'https';
import xlsx from 'xlsx';
import async from 'async';
import moment from 'moment';

import db from './config/db-connection';
import CurrencyDay from './models/currency-day';

// Constants
import COL from './constants/columns';
import CURR from './constants/currencies';
import FILE_URL from './constants/ine-file-url.js';

const INT_REGEX = /^\d+$/;
const FLOAT_REGEX = /^\d+([.,]\d+)?$/;

moment.locale('es');

function seed() {

  async.waterfall([

    // Connect to database
    db.connect,

    // Download the file
    downloadFile,

    function readFileAndGetLastDate(theFile, cbReadFileAndGetLastDate) {

      async.parallel({
        // Read the file and discard the unuseful lines
        lines: async.apply(
          readFile,
          theFile
        ),

        // Get last date existing on DB
        lastDate: CurrencyDay.getLastDate
      }, cbReadFileAndGetLastDate);

    },

    // Parse the array of lines and transform it to an
    // array of days
    makeArrayOfDays,

    // Save the currencies into the database
    CurrencyDay.insertDays

  ], (err, inserted) => {
    if (err) {
      console.log(err);
      return process.exit(1);
    }

    console.log(`Seeded with ${inserted} rows. :)`);
    return process.exit();
  });
}

/**
 *
 * @param {Array} lines - Array of useful lines
 * @param {function(Error, Array)} cb - The callback
 */
function makeArrayOfDays({ lastDate, lines }, cb) {

  const days = {};
  let year, month, day, date, line;

  for (let i = 0; i < lines.length; i++) {

    line = lines[i];
    day = line[COL.DAY];
    month = line[COL.MONTH] || month;
    year = line[COL.YEAR] || year;
    date = getDate(day, month, year);

    if (date.isSameOrBefore(lastDate)) continue;

    days[date.format('L')] = ({
      date: date.toDate(),
      currencies: [
        {
          iso: CURR.USD,
          buy: getValue(line[COL.USD_BUY]),
          sell: getValue(line[COL.USD_SELL])
        },
        {
          iso: CURR.ARS,
          buy: getValue(line[COL.ARS_BUY]),
          sell: getValue(line[COL.ARS_SELL])
        },
        {
          iso: CURR.BRL,
          buy: getValue(line[COL.BRL_BUY]),
          sell: getValue(line[COL.BRL_SELL])
        },
        {
          iso: CURR.EUR,
          buy: getValue(line[COL.EUR_BUY]),
          sell: getValue(line[COL.EUR_SELL])
        }
      ]
    });
  }

  return cb(null, days);
}

/**
 * Returns the value if it's a valid float or null otherwise
 * @param {string} value Value expected to be a float
 */
function getValue(value) {
  return FLOAT_REGEX.test(value) ? value.replace(',','.') : null;
}

/**
 * Get a moment instance by parsing
 * day, month, and year
 *
 * @param {number} day
 * @param {string} month
 * @param {number} year
 */
function getDate(day, month, year) {

  const date = `${day}-${purgeMonth(month)}.-${year}`;

  return moment.utc(date, 'D-MMM-YYYY');
}

/**
 * Remove trailing spaces and lowerizes the month
 * Also standarize the 'code'
 * (e.g. 'set', 'sep' and 'septiembre' is returned as 'sep')
 * @param {string} month String found in the month column of the file
 */
function purgeMonth(month) {
  month = month.toLowerCase().trim();

  switch (month) {
    case 'set':
    case 'setiembre':
    case 'septiembre':
      month = 'sep';
      break;


    case 'agosto':
      month = 'ago';
      break;
  }

  return month;
}

/**
 * Read the file and calls the callback with an array
 * of useful lines
 * @param {Buffer} file - A buffer with the file
 * @param {function(Error,Array)} cb - The callback
 */
function readFile(file, cb) {

  console.log("\nReading file...");

  /*
   * Opens the file and get array of arrays
   */
  const book = xlsx.read(file, { type: 'buffer' }),
    sheet = book.Sheets[book.SheetNames[0]],
    lines = xlsx.utils.sheet_to_json(sheet, {
      header: 1,
      range: 7
    });

  const usefulLines = [];

  lines.forEach((line) => {
    if (INT_REGEX.test(line[0])) {
      usefulLines.push(line);
    }
  });

  console.log(`Found ${usefulLines.length} useful lines`);

  return cb(null, usefulLines);
}

/**
 * Download the INE file
 *
 * @param {function(Error,Buffer)} cb
 */
function downloadFile(cb) {
  const buffers = [];
  let fileSize = 0;

  https.get(FILE_URL, (response) => {

    console.log("Downloading file...");

    const progressInterval = setInterval(() => {
      console.log(fileSize + " bytes");
    }, 500);

    response.on('data', (chunk) => {
      buffers.push(chunk);
      fileSize += chunk.byteLength;
    });

    response.on('error', (err) => {
      return cb(err);
    });

    response.on('end', () => {
      console.log(fileSize + " bytes");
      console.log("File downloaded");

      clearInterval(progressInterval);

      return cb(null, Buffer.concat(buffers));
    });
  }, (err) => {
    return cb(err)
  });
}

seed();
