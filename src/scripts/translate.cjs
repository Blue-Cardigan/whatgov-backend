const translator = require('american-british-english-translator');

// Test different phrases (now in American English)
const phrases = [
    "cozy potato with lazer aluminum",
    "The elevator is broken",
    "I need to buy some chips",
    "Let's watch soccer on the weekend"
];

// Options for American to British translation
const options = {
    british: false
};

// Test each phrase
phrases.forEach(phrase => {
    const result = translator.translate(phrase, options);
    let translatedPhrase = phrase;

    // Only process if we have results
    if (result['1']) {
        result['1'].forEach(item => {
            const word = Object.keys(item)[0];
            const details = item[word];
            
            if (details.issue === "American English Spelling") {
                // Direct replacement for spelling differences
                const britishSpelling = details.details;
                translatedPhrase = translatedPhrase.replace(new RegExp(word, 'gi'), britishSpelling);
            }
        });
    }

    console.log(`\nOriginal (American): ${phrase}`);
    console.log(`British spelling: ${translatedPhrase}`);
    
    // Save full analysis
    const fs = require('fs');
    const output = {
        original: phrase,
        translated: translatedPhrase,
        analysis: result
    };
    fs.appendFileSync('translate-output.json', JSON.stringify(output, null, 2) + ',\n');
}); 