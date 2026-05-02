// Simple test to verify function works
module.exports = async function (context, req) {
  context.log('Test function called');
  
  context.res = {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ 
      message: 'Function is working!',
      timestamp: new Date().toISOString(),
    }),
  };
};

