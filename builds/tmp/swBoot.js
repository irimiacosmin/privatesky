const or = require('overwrite-require');
or.enableForEnvironment(or.constants.BROWSER_ENVIRONMENT_TYPE);

require("../../modules/callflow/standardGlobalSymbols");
require("./swBoot_intermediar");
