# Validation codes

Every finding code, with its severity, the wizard step that can fix it, its
message template, its hint and an example. Codes are stable: never rename one or
change its meaning; add a new code instead. Sections are sorted by code.

A unit test in `karmania-core` fails if a registered code is missing here, if its
severity or step disagrees with the registry, or if this file lists a code that
is not registered. In message templates, `{name}` marks a value filled in at
runtime. Numbers in messages use thousands separators (1,203).

## `dataset.too_large`

- Severity: error
- Step: none
- Message: This dataset would have about {count} {things}, which is more than the limit of {limit}.
- Hint: Use fewer {things}, a larger cell size, or split the data into several datasets.
- Example: This dataset would have about 200,000,000 cells, which is more than the limit of 134,217,728.

## `table.column.length_mismatch`

- Severity: error
- Step: none
- Message: Column "{name}" has {count} values, but the first column "{first}" has {expected}.
- Hint: Make every column the same length.
- Example: Column "grade" has 1,204 values, but the first column "x" has 5.

## `table.column.name_duplicate`

- Severity: error
- Step: mapping
- Message: The column name "{name}" is used more than once.
- Hint: Give each column a different name, or ignore the extra columns.
- Example: The column name "grade" is used more than once.

## `table.column.name_empty`

- Severity: error
- Step: mapping
- Message: Column {position} has no name.
- Hint: Give the column a name, or ignore it.
- Example: Column 3 has no name.
