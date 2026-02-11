// Simple test script to verify backend is working
const http = require('http');

function testEndpoint(path, method = 'GET', body = null) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'localhost',
            port: 3001,
            path: path,
            method: method,
            headers: { 'Content-Type': 'application/json' }
        };

        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                console.log(`\nTesting ${method} ${path}:`);
                console.log(`Status: ${res.statusCode}`);
                console.log(`Response: ${data.substring(0, 100)}...`);
                resolve();
            });
        });

        if (body) req.write(JSON.stringify(body));
        req.end();
    });
}

async function runTests() {
    console.log("Starting Backend Tests...");
    
    // 1. Test Health
    await testEndpoint('/api/health');

    // 2. Test AI Explanation
    await testEndpoint('/api/explain', 'POST', {
        vendor: "AWS",
        increasePercentage: 15,
        currentSpend: 50000
    });
    
    console.log("\nTests Complete!");
}

runTests();