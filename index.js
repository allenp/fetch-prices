//add libraries
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth')
const fetch = require('fetch');
const csv = require('fast-csv');
const fs = require('fs');
const path = require('path');
//end of add libraries

let myargs = process.argv.slice(2);

//configure puppeteer for stealth mode
puppeteer.use(StealthPlugin());

const parseOptions = { headers: true, skipRows: 0, maxRows: null };

if (myargs.length > 0) {
    parseOptions.skipRows = Math.max(0, parseInt(myargs[0]));
}

if (myargs.length > 1) {
    parseOptions.maxRows = Math.max(1, parseInt(myargs[1]));
}

let dataFile = '';
if (myargs.length > 2) {
    dataFile = path.resolve(myargs[2]);
}/* else {
    //default path for data file
    dataFile = path.resolve(__dirname, 'data', 'Assessor_Parcels_Data_-_2018.csv');
}*/

//open read stream and setup processing for each row
fs.createReadStream(dataFile)
    .pipe(csv.parse(parseOptions))
    .pipe(csv.format({ headers: true }))
    .transform((row, next) => {
        handleRowData(row).then( (row) => {
            return next(null, row);
        }).catch( (error) => {
            console.error(error);
        });
    })
    .pipe(process.stdout)
    .on('end', handleEnd);

/**
 * handles processing for each row of data:
 *   > gets sale info for address, combine with existing row info and outputs as csv to stdout
 * @param row
 * @returns {Promise<{SalePrice: *, SaleDate: *}>}
 */
async function handleRowData(row) {

    let address = `${row.HouseNo} ${row.StreetName}`;

    try {
        let prices = await getPropertyInfo(address);
        if (prices.length == 3) {
            row = {
                ...row,
                PropertySharkAddress: prices[0],
                SaleDate: prices[1],
                SalePrice: prices[2]
            };
        }
    } catch (e) {}

    return row;
}

function handleEnd()
{
   console.error("done!");   
   process.exit();
}

async function getPropertyInfo(address) {

    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto('https://www.propertyshark.com/mason/');

    address = encodeURI(address);
    let url = `https://www.propertyshark.com/plugin/autocomplete/address.json?locale=nationwide&current_location=california&add_locales=1&product=homepage&text=${address}&_=M`;

    await page.goto(url);
    var content = await page.content();

    let stripped = content.replace(/<\/?[^>]+(>|$)/g, "");
    let properties = await JSON.parse(stripped);
    let info = [];

    if (properties == null || properties.length === 0 || properties.error == true)
        return info;

    if (properties.content.length == 0)
        return info;

    info.push(properties.content[0].name);

    let propertyUrl = `https://www.propertyshark.com/mason/Property/${properties.content[0].target_propkey}`;
    await page.goto(propertyUrl);

    $tr = await page.evaluateHandle(() => {
        return document.querySelectorAll('div .cols22 > table table tr');
    });

    let prices = await page.evaluate(($tr) => {
        let bits = [];
        for (let i = 0; i < $tr.length; i++) {
            let text = $tr[i].innerText;
            if (text.indexOf('Sale date:') !== -1 || text.indexOf('Sale price:') !== -1) {
                data = text.split(':\t');
                sanitized = data[1].replace(/\./g, '').replace(/,/g, '').replace(/\$/g, '');
                bits.push(sanitized);
            }
            //can stop looking after we've found date and price
            if (bits.length == 2) {
                break;
            }
        }
        return bits;
    }, $tr);

    info = info.concat(prices);

    await $tr.dispose();
    await browser.close();

    return info;
}



