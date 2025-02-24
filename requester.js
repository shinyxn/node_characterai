const puppeteer = require('puppeteer-core');
//const StealthPlugin = require('puppeteer-extra-plugin-stealth')
const fs = require("fs");

class Requester {
    browser = undefined;
    page = undefined;

    #initialized = false;
    #hasDisplayed = false;
    #headless = 'new';
    puppeteerPath = undefined;
    
    usePlus = false;

    constructor() {

    }
    isInitialized() {
        return this.#initialized;
    }

    async tesKoneksi(page) {
        await page.goto("https://google.com", {
            timeout: 0,
            waitUntil: 'networkidle0',
          });

        const screenData = await page.screenshot({encoding: 'binary', type: 'jpeg', quality: 100});
        if (!!screenData) {
        fs.writeFileSync('ayayayaya.jpg', screenData);
        } else {
        throw Error('Unable to take screenshot');
        }
    
    }

    async waitForWaitingRoom(page) {
        if (!this.usePlus) {
            return new Promise(async(resolve) => {
                try {
                    let interval;
                    let pass = true;
                    await page.goto("https://beta.character.ai");
                    
                    const minute = 1000 * 60; // Update every minute

                    // Keep waiting until false
                    async function check() {
                        if (pass) {
                            pass = false;

                            const waitingRoomTimeLeft = await page.evaluate(async() => {
                                try {
                                    const contentContainer = document.querySelector(".content-container");
                                    const sections = contentContainer.querySelectorAll("section")
                                    const h2Element = sections[i].querySelector("h2");
                                    const h2Text = h2Element.innerText;
                                    const regex = /\d+/g;
                                    const matches = h2Text.match(regex);
        
                                    if (matches) return matches[0];
                                } catch (error) {return};
                            }, minute);
                            
                            const waiting = (waitingRoomTimeLeft != null);
                            if (waiting) {
                                console.log(`[node_characterai] Puppeteer - Currently in cloudflare's waiting room. Time left: ${waitingRoomTimeLeft}`);
                            } else {
                                clearInterval(interval);
                                resolve();
                            }
                            pass = true;
                        };
                    }

                    interval = setInterval(check, minute);
                    await check();
                } catch (error) {
                    console.log(`[node_characterai] Puppeteer - There was a fatal error while checking for cloudflare's waiting room.`);
                    console.log(error);
                }
            });
        }
    }

    async initialize() {
        if (!this.isInitialized());

        console.log("[node_characterai] Puppeteer - This is an experimental feature. Please report any issues on github.");

       // puppeteer.use(StealthPlugin())
        const browser = await puppeteer.launch({
          headless: true,
            args: [
            "--no-sandbox",
            "--disable-gpu",
            ]
          });
          
        this.browser = browser;
        let page = await browser.newPage();
        this.page = page;

        await page.setRequestInterception(false);

        await page.setViewport({width: 1920, height: 1080});

        // await page.setViewport({width: 1920, height: 1080});
        await page.setJavaScriptEnabled(true);
        await page.setDefaultNavigationTimeout(0);

        const userAgent = 'CharacterAI/1.0.0 (iPhone; iOS 14.4.2; Scale/3.00)';
        await page.setUserAgent(userAgent);

        //await this.waitForWaitingRoom(page);
        await this.tesKoneksi(page);

        console.log("[node_characterai] Puppeteer - Done with setup");

    }

    async request(url, options) {
        const page = this.page;

        const method = options.method;

        const body = (method == 'GET' ? {} : options.body);
        const headers = options.headers;

        let response

        if (this.usePlus) url.replace('beta.character.ai', 'plus.character.ai');

        try {
            const payload = {
                method: method,
                headers: headers,
                body: body
            }

            if (url.endsWith("/streaming/")) {
                await page.setRequestInterception(false);
                if (!this.#hasDisplayed) {
                    console.log("[node_characterai] Puppeteer - Eval-fetching is an experimental feature and may be slower. Please report any issues on github")
                    this.#hasDisplayed = true;
                }

                // Bless @roogue & @drizzle-mizzle for the code here!
                response = await page.evaluate(
                    async (payload, url) => {
                        const response = await fetch(url, payload);

                        const data = await response.text();
                        const matches = data.match(/\{.*\}/g);

                        const responseText = matches[matches.length - 1];

                        let result = {
                            code: 500,
                        }

                        if (!matches) result = null;
                        else {
                            result.code = 200;
                            result.response = responseText;
                        }

                        return result;
                    },
                    payload,
                    url
                );

                response.status = () => response.code // compatibilty reasons
                response.text = () => response.response // compatibilty reasons
            } else {
                await page.setRequestInterception(true);
                let initialRequest = true;

                page.once('request', request => {
                    var data = {
                        'method': method,
                        'postData': body,
                        'headers': headers
                    };

                    if (request.isNavigationRequest() && !initialRequest) {
                        return request.abort();
                    }

                    try {
                        initialRequest = false;
                        request.continue(data);
                    } catch (error) {
                        console.log("[node_characterai] Puppeteer - Non fatal error: " + error);
                    }
                });
                response = await page.goto(url, { waitUntil: 'networkidle2' });
            }
        } catch (error) {
            console.log("[node_characterai] Puppeteer - " + error)
        }

        return response;
    }
    
    async uploadBuffer(buffer, client) {
        const page = this.page;

        let response

        try {
            await page.setRequestInterception(false);

            response = await page.evaluate(
                async (headers, buffer) => {
                        var result = {
                            code: 500
                        };

                        const blob = new Blob([buffer], { type: 'image/png' });
                        const formData = new FormData();
                        formData.append("image", blob, 'image.png');

                        let head = headers;
                        delete head["Content-Type"];
                        // ^ Is this even being used?

                        const uploadResponse = await fetch("https://beta.character.ai/chat/upload-image/", {
                            headers: headers,
                            method: "POST",
                            body: formData
                        })

                        if (uploadResponse.status == 200) {
                            result.code = 200;

                            let uploadResponseJSON = await uploadResponse.json();
                            result.response = uploadResponseJSON.value;
                        }

                        return result;
                    },
                    client.getHeaders(), buffer
            );

            response.status = () => response.code // compatibilty reasons
            response.body = () => response.response // compatibilty reasons
        } catch (error) {
            console.log("[node_characterai] Puppeteer - " + error)
        }

        return response;
    }
}

module.exports = Requester;
