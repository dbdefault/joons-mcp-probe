import { createSchemaChecker } from './schema.js';

// The caller invokes this only when the tools capability exists; [] yields TOOLS_EMPTY.
export function checkTools(rawTools, { deadline = Infinity, now = Date.now } = {}) {
  const items = [];
  const findings = [];
  const seen = new Set();
  const checkBudget = () => { if (now() >= deadline) throw Object.assign(new Error('Check budget exhausted'), { code: 'CHECKS_BUDGET_EXCEEDED' }); };
  const compile = createSchemaChecker({ checkBudget });
  const add = (id, severity, category, message, tool) => {
    const finding = { id, severity, category, message };
    if (tool !== undefined) finding.tool = tool;
    findings.push(finding);
  };
  if (!Array.isArray(rawTools)) return { items, findings };
  if (rawTools.length === 0) add('TOOLS_EMPTY', 'warning', 'tools', 'No tools were returned.');
  try { for (const entry of rawTools) {
    checkBudget();
    // Accessor and proxy failures are treated as malformed input.
    let name, description, inputSchema, outputSchema, hasInput, hasOutput;
    try {
      name = entry?.name;
      description = entry?.description;
      hasInput = entry != null && Object.hasOwn(entry, 'inputSchema');
      hasOutput = entry != null && Object.hasOwn(entry, 'outputSchema');
      inputSchema = entry?.inputSchema;
      outputSchema = entry?.outputSchema;
    } catch { /* malformed entry */ }
    const tool = typeof name === 'string' ? name : undefined;
    if (tool === undefined) add('TOOL_NAME_MISSING', 'fail', 'tools', 'Tool name is missing or not a string.');
    else {
      if (!/^[A-Za-z0-9_.-]{1,128}$/.test(name)) add('TOOL_NAME_INVALID', 'warning', 'tools', 'Tool name does not follow the naming guidance.', tool);
      if (seen.has(name)) add('TOOL_NAME_DUPLICATE', 'fail', 'tools', 'Tool name is duplicated.', tool);
      seen.add(name);
    }
    const hasDescription = typeof description === 'string' && description.trim().length > 0;
    if (!hasDescription) add('TOOL_DESCRIPTION_MISSING', 'warning', 'tools', 'Tool description is missing or blank.', tool);
    let schemaValid = false;
    if (!hasInput) add('TOOL_SCHEMA_MISSING', 'fail', 'schema', 'Tool input schema is missing.', tool);
    else {
      let objectType = false;
      try { objectType = inputSchema !== null && typeof inputSchema === 'object' && !Array.isArray(inputSchema) && inputSchema.type === 'object'; } catch { /* invalid schema */ }
      if (!objectType) add('TOOL_SCHEMA_NOT_OBJECT', 'fail', 'schema', 'Tool input schema must have type object.', tool);
      const compiled = compile(inputSchema);
      if (!compiled) add('TOOL_SCHEMA_INVALID', 'fail', 'schema', 'Tool input schema could not be compiled.', tool);
      schemaValid = objectType && compiled;
    }
    if (hasOutput) {
      let objectType = false;
      try { objectType = outputSchema !== null && typeof outputSchema === 'object' && !Array.isArray(outputSchema) && outputSchema.type === 'object'; } catch { /* invalid schema */ }
      if (!objectType || !compile(outputSchema)) add('TOOL_OUTPUT_SCHEMA_INVALID', 'warning', 'schema', 'Tool output schema must compile and have type object.', tool);
    }
    items.push({ name: tool ?? null, hasDescription, schemaValid });
  } } catch (error) {
    if (error.code !== 'CHECKS_BUDGET_EXCEEDED') throw error;
    add('CHECKS_BUDGET_EXCEEDED', 'warning', 'performance', 'Tool checks stopped at the inspection budget.');
    return { items, findings, budgetExceeded: true };
  }
  return { items, findings };
}
