/**
 * MIT License
 *
 * Copyright (c) 2018 Click to Cloud Pty Ltd
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 **/
const _ = require('lodash');
const fs = require('fs');
const path = require('path');
const build = require('./builder');
const { time, timeEnd, } = require('../utils');
const FileUpdates = require('../utils/fileUpdates');
const normalize = require('../template');
const parse = require('../parser');
const AST = require('../ast');

// Typings for all the files in the source directory and destination directory
let allTypings = null;

// Typings for the Salesforce apex library classes
let libraryTypings = null;

// Mapping from capitalized names to class typings
const typingsData = {};

const prepTypingsData = () => {
    if(allTypings) {
        _.forEach(allTypings, typing => {
            const name = _.toUpper(typing.name);
            typingsData[name] = typing;

            _.forEach(typing.classDeclarations, decl => {
                const qualifiedName = name + '.' + _.toUpper(decl.name);
                decl.name = qualifiedName;
                typingsData[qualifiedName] = decl;
            });

            _.forEach(typing.interfaceDeclarations, decl => {
                const qualifiedName = name + '.' + _.toUpper(decl.name);
                decl.name = qualifiedName;
                typingsData[qualifiedName] = decl;
            });
        });
    }

    if(libraryTypings) {
        _.forEach(libraryTypings, (library, libraryName) => {
            libraryName = _.toUpper(libraryName);
            _.forEach(library, typing => {
                const name = _.toUpper(typing.name);
                typingsData[libraryName + '.' + name] = typing;

                _.forEach(typing.classDeclarations, decl => {
                    const qualifiedName = libraryName + '.' + name + '.' + _.toUpper(decl.name);
                    decl.name = qualifiedName;
                    typingsData[qualifiedName] = decl;
                });

                _.forEach(typing.interfaceDeclarations, decl => {
                    const qualifiedName = libraryName + '.' + name + '.' + _.toUpper(decl.name);
                    decl.name = qualifiedName;
                    typingsData[qualifiedName] = decl;
                });
            });
        });
    }
};

// utility to get a list of super type names
// accept capitalized type name
const getSuperTypeNames = (typeName, config) => {
    if(!typeName) {
        return ['OBJECT'];
    }

    const typing = lookup(typeName, null, config);
    if(!typing) {
        return ['OBJECT'];
    }

    let names = [];

    if(typing.superclassType) {
        names = [
            ...names,
            typing.superclassType,
            ...getSuperTypeNames(typing.superclassType, config),
        ];
    }

    if(typing.superInterfaceTypes) {
        names = [
            ...names,
            ...typing.superInterfaceTypes,
            ..._.flatMap(typing.superInterfaceTypes, type => getSuperTypeNames(type, config)),
        ];
    }

    return _.uniq(names);
};

// capitalized names
const canBeAssignedTo = (fromType, toType) => {
    if(fromType === toType) {
        return true;
    }

    const superTypes = getSuperTypeNames(fromType);
    return _.includes(superTypes, toType);
};

// fromTypes case insensitive
// toTypes capitalized
const canArgTypesBeAssignedTo = (fromTypes, toTypes) => {
    for(let i in fromTypes) {
        const fromType = _.toUpper(fromTypes[i]);
        const toType = toTypes[i];
        if(!canBeAssignedTo(fromType, toType)) {
            return false;
        }
    }

    return true;
};

const lookup = (name, currentTypeName, config) => {
    loadTypings(config);
    name = _.toUpper(name);

    let result = typingsData[name];
    if(!result) {
        if(currentTypeName && _.indexOf(name, '.') > 0) {
            result = typingsData[_.toUpper(currentTypeName) + '.' + name];
        }
    }
    if(!result) {
        result = typingsData['SYSTEM.' + name];
    }

    return result;
};

const getVariableType = (typing, variableName) => {
    if(typing && variableName) {
        const found = _.filter(typing.fieldDeclarations, field => {
            field = field[0];
            return _.toUpper(field.name) === _.toUpper(variableName);
        });

        if(!_.isEmpty(found)) {
            return found[0][0].type;
        }
    }
};

const getMethodType = (typing, methodName, argTypes) => {
    argTypes = argTypes || [];
    if(typing && methodName) {
        const found = _.filter(typing.methodDeclarations, method => {
            return _.toUpper(method.name) === _.toUpper(methodName) &&
                _.size(method.parameters) === _.size(argTypes);
        });

        const size = _.size(found);
        if(size > 1) {
            const refined = _.filter(found, method => {
                const paramTypeNames = _.map(method.parameters, param => _.toUpper(param.type));
                const argTypeNames = _.map(argTypes, type => _.toUpper(type));
                const canAssign = canArgTypesBeAssignedTo(argTypeNames, paramTypeNames);
                return canAssign;
            });

            if(!_.isEmpty(refined)) {
                return refined[0].returnType;
            }
        }
        else if(size === 1) {
            return found[0].returnType;
        }
    }
};

const loadTypings = config => {
    if(!allTypings) {
        loadAllTypings(config);
    }

    if(!libraryTypings) {
        loadLibraryTypings(config);
    }
};

const loadAllTypings = config => {
    const allTypingsPath = config.cacheDir + path.sep + 'allTypings.json';
    if(fs.existsSync(allTypingsPath)) {
        try {
            allTypings = JSON.parse(fs.readFileSync(allTypingsPath, 'utf8'));
        }
        catch(e) {
            console.error('Failed to load all typings', e);
        }
    }

    prepTypingsData();
};

// Get all the typings from the source and destination directories
const getAllTypings = config => {
    if(!allTypings) {
        loadAllTypings(config);
    }

    if(!allTypings) {
        allTypings = {};
    }

    return allTypings;
};

const loadLibraryTypings = config => {
    libraryTypings = {};

    _.each(fs.readdirSync(config.libraryDir), subdir => {
        const libraryTypingsPath = config.libraryDir + path.sep + subdir + path.sep + 'typings.json';
        if(fs.existsSync(libraryTypingsPath)) {
            try {
                libraryTypings[subdir] = JSON.parse(fs.readFileSync(libraryTypingsPath, 'utf8'));
            }
            catch(e) {
                console.error(`Failed to load library typings for ${subdir}`, e);
            }
        }
    });

    prepTypingsData();
};

// Get all the typings from library apex classes
const getLibraryTypings = config => {
    if(!libraryTypings) {
        loadLibraryTypings(config);
    }

    return libraryTypings;
};

// Flush the infos to the local storage
const flush = (config) => {
    const allTypingsPath = config.cacheDir + path.sep + 'allTypings.json';
    const allTypings = getAllTypings(config);
    fs.writeFileSync(allTypingsPath, JSON.stringify(allTypings));
};

// Slim the typing info, removing empty fields
const slim = target => {
    if(_.isPlainObject(target)) {
        return _.chain(target)
            .toPairs()
            .reject(pair => _.isEmpty(pair[1]))
            .map(([key, value]) => [key, slim(value)])
            .fromPairs()
            .value();
    }
    else if(_.isArray(target)) {
        return _.map(target, slim);
    }
    else {
        return target;
    }
};

// Add typings from the AST node
const add = (node, config) => {
    const typeDeclaration = AST.getTopLevelType(node);

    const typing = build(typeDeclaration, {
        includeComments: false,
    });

    addTyping(typing, config);
};

// Add typings
const addTyping = (typing, config) => {
    const allTypings = getAllTypings(config);
    allTypings[typing.name] = slim(typing);
};

// Scan the file and add typings
const scan = (fileName, config) => {
    time(`Scan file ${fileName}`, config);

    return new Promise((resolve, reject) => {
        if(!FileUpdates.hasChanged(fileName, config)) {
            resolve(null);
        }
        else {
            fs.readFile(fileName, 'utf8', (error, src) => {
                timeEnd(`Scan file ${fileName}`, config);
                if(error) {
                    reject(error);
                }

                try {
                    if(!fileName.endsWith('.cls')) {
                        time('Normalize', config);
                        src = normalize(src, config);
                        timeEnd('Normalize', config);
                    }

                    time('Parse', config);
                    const result = parse(src);
                    timeEnd('Parse', config);

                    add(result, config);

                    resolve(result);
                }
                catch(e) {
                    if(config.ignoreErrors) {
                        console.error(new Error(`Failed to scan ${fileName}:\n${e}`));
                        resolve(null);
                    }
                    else {
                        reject(new Error(`Failed to scan ${fileName}:\n${e}`));
                        console.error(`Failed to scan ${fileName}`);
                        throw e;
                    }
                }
            });
        }
    });
};

// The global typings object
const Typings = {
    add,
    addTyping,
    scan,
    getAllTypings,
    getLibraryTypings,
    flush,
    lookup,
    getVariableType,
    getMethodType,
};

module.exports = Typings;
