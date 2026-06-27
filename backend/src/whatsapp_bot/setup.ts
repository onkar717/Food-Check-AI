import twilio from 'twilio';
import dotenv from 'dotenv';

dotenv.config();

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;

if (!accountSid || !authToken) {
  console.error('❌ Missing Twilio credentials!');
  console.log('Please set TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN in your .env file');
  process.exit(1);
}

const client = twilio(accountSid, authToken);

async function setupWebhook() {
  try {
    console.log('🔧 Setting up Twilio webhook...');
    
    // Get your Twilio phone number
    const incomingPhoneNumbers = await client.incomingPhoneNumbers.list();
    
    if (incomingPhoneNumbers.length === 0) {
      console.log('📱 No phone numbers found. Please add a WhatsApp-enabled number in your Twilio console.');
      return;
    }
    
    console.log('📱 Found phone numbers:');
    incomingPhoneNumbers.forEach((number, index) => {
      console.log(`${index + 1}. ${number.phoneNumber} (${number.friendlyName})`);
    });
    
    console.log('\n📋 Next steps:');
    console.log('1. Go to https://console.twilio.com/');
    console.log('2. Navigate to Messaging > Try it out > Send a WhatsApp message');
    console.log('3. Use the sandbox number: +14155238886');
    console.log('4. Send "join <your-sandbox-code>" to activate');
    console.log('5. Set webhook URL to: http://your-domain.com/webhook');
    console.log('6. For local testing, use ngrok: ngrok http 3001');
    
  } catch (error) {
    console.error('❌ Error setting up webhook:', error);
  }
}

async function testConnection() {
  try {
    console.log('🔍 Testing Twilio connection...');
    
    const account = await client.api.accounts(accountSid).fetch();
    console.log('✅ Connected to Twilio account:', account.friendlyName);
    
  } catch (error) {
    console.error('❌ Failed to connect to Twilio:', error);
  }
}

// Run setup
async function main() {
  console.log('🚀 Food Check AI WhatsApp Bot Setup');
  console.log('==============================\n');
  
  await testConnection();
  console.log('');
  await setupWebhook();
}

main().catch(console.error); 