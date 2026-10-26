# Validation codes

Every finding code, with its severity, the wizard step that can fix it, its
message template, its hint and an example. Codes are stable: never rename one or
change its meaning; add a new code instead. Sections are sorted by code.

A unit test in `karmania-core` fails if a registered code is missing here, if its
severity or step disagrees with the registry, or if this file lists a code that
is not registered. In message templates, `{name}` marks a value filled in at
runtime. Numbers in messages use thousands separators (1,203).

## `dataset.coordinates.incomplete`

- Severity: error
- Step: none
- Message: The coordinate list ends with an incomplete position: it has {count} values, which is not a multiple of 3.
- Hint: Give X, Y and Z for every position.
- Example: The coordinate list ends with an incomplete position: it has 4 values, which is not a multiple of 3.

## `dataset.coordinates.length_mismatch`

- Severity: error
- Step: none
- Message: The coordinate lists have different lengths: X has {nx} values, Y has {ny}[, Z has {nz}].
- Hint: Give X, Y and Z (if used) the same number of values.
- Example: The coordinate lists have different lengths: X has 1,204 values, Y has 5.

## `dataset.empty`

- Severity: error
- Step: file
- Message: The dataset has no {things}.
- Hint: Check that the file has data rows and that you chose the right file.
- Example: The dataset has no points.

## `dataset.too_large`

- Severity: error
- Step: none
- Message: This dataset would have about {count} {things}, which is more than the limit of {limit}. (When the count is too large to calculate: This dataset would have far more {things} than the limit of {limit}.)
- Hint: Use fewer {things}, or split the data into several datasets.
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
