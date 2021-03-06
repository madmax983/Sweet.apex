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
const AST = require('../../ast');
const getValue = require('../../valueProvider');

const getInvokeMethodParams = method => {
    return _.map(method.parameters, (param, index) => `(${param.type})args.get(${index})`).join(', ');
};

const getInvokeMethod = method => {
    if(method.returnType === 'void') {
        return `this.${method.name}(${getInvokeMethodParams(method)});`;
    }
    else {
        return `return this.${method.name}(${getInvokeMethodParams(method)});`;
    }
};

const ReflectFeature = {
    accept: ({ current, parent, }) => {
        const accepted =
            current.node === 'TypeDeclaration' &&
            AST.hasAnnotation(current.modifiers, 'reflect');
        return accepted;
    },

    run: ({ current, parent, root, }) => {
        const typeDeclaration = current;
        const annotation = AST.findAnnotation(typeDeclaration.modifiers, 'reflect');
        AST.removeChild(typeDeclaration, 'modifiers', annotation);

        typeDeclaration.superInterfaceTypes = typeDeclaration.superInterfaceTypes || [];
        typeDeclaration.superInterfaceTypes.push({
            node: 'SimpleType',
            name: {
                identifier: 'Sweet.Reflectable',
                node: 'SimpleName',
            },
        });

        const fields = [];
        const methods = [];

        _.each(typeDeclaration.bodyDeclarations, bodyDeclaration => {
            if(bodyDeclaration.node === 'FieldDeclaration' && !AST.hasModifier(bodyDeclaration.modifiers, 'static')) {
                const type = getValue(bodyDeclaration.type);
                _.each(bodyDeclaration.fragments, fragment => {
                    const name = getValue(fragment.name);
                    fields.push({
                        name,
                        type,
                    });
                });
            }
            else if(bodyDeclaration.node === 'MethodDeclaration' && !AST.hasModifier(bodyDeclaration.modifiers, 'static') && !bodyDeclaration.constructor) {
                const name = getValue(bodyDeclaration.name);
                const parameters = AST.getParameters(bodyDeclaration.parameters);
                const returnType = getValue(bodyDeclaration.returnType2);
                methods.push({
                    name,
                    parameters,
                    returnType,
                });
            }
        });

        const newNodes = [];

        newNodes.push(AST.parseEmptyLine());
        newNodes.push(AST.parseClassBodyDeclaration(`public List<String> reflect_getFieldNames() {
            return new List<String>{ ${_.map(fields, field => "'" + field.name + "'").join(', ')} };
        }`));

        const getFieldValueCodes = [];
        _.each(fields, (field, index) => {
            getFieldValueCodes.push(`${index === 0 ? '' : 'else '}if(name == '${field.name}') {
                return this.${field.name};
            }`);
        });
        getFieldValueCodes.push(`else {
            throw new Sweet.SweetException('Field ' + name + ' does not exist');
        }`);
        newNodes.push(AST.parseEmptyLine());
        newNodes.push(AST.parseClassBodyDeclaration(`public Object reflect_getFieldValue(String name) {
            ${getFieldValueCodes.join('\n')}
        }`));

        const setFieldValueCodes = [];
        _.each(fields, (field, index) => {
            setFieldValueCodes.push(`${index === 0 ? '' : 'else '}if(name == '${field.name}') {
                this.${field.name} = (${field.type})value;
            }`);
        });
        setFieldValueCodes.push(`else {
            throw new Sweet.SweetException('Field ' + name + ' does not exist');
        }`);
        newNodes.push(AST.parseEmptyLine());
        newNodes.push(AST.parseClassBodyDeclaration(`public void reflect_setFieldValue(String name, Object value) {
            ${setFieldValueCodes.join('\n')}
        }`));

        newNodes.push(AST.parseEmptyLine());
        newNodes.push(AST.parseClassBodyDeclaration(`public List<String> reflect_getMethodNames() {
            return new List<String>{ ${_.map(methods, method => "'" + method.name + "'").join(', ')} };
        }`));

        const invokeMethodCodes = [];
        _.each(methods, (method, index) => {
            invokeMethodCodes.push(`${index === 0 ? '' : 'else '}if(name == '${method.name}') {
                ${getInvokeMethod(method)}
            }`);
        });
        invokeMethodCodes.push(`else {
            throw new Sweet.SweetException('Method ' + name + ' does not exist');
        }`);
        invokeMethodCodes.push(`return null;`);
        newNodes.push(AST.parseEmptyLine());
        newNodes.push(AST.parseClassBodyDeclaration(`public Object reflect_invokeMethod(String name, List<Object> args) {
            ${invokeMethodCodes.join('\n')}
        }`));

        AST.appendChildren(typeDeclaration, 'bodyDeclarations', newNodes);
    },
};

module.exports = ReflectFeature;
