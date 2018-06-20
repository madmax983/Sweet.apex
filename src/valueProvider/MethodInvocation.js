const _ = require('lodash');
const getValue = require('./index.js');

const MethodInvocation = node => {
    const name = node.name;
    const expression = node.expression;
    const args = node.arguments;

    return `${getValue(expression)}.${getValue(name)}(${_.map(args, getValue).join(', ')})`;
};

module.exports = MethodInvocation;
