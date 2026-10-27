import { describe, expect, it } from 'vitest';
import { groupFiles } from './grouping.js';

const file = (name: string, relativePath = ''): File => {
  const made = new File([], name);
  Object.defineProperty(made, 'webkitRelativePath', { value: relativePath });
  return made;
};

const names = (groups: ReturnType<typeof groupFiles>): [string, string[]][] =>
  groups.map((g) => [g.file.name, g.sidecars.map((s) => s.name)]);

describe('grouping files with their sidecars', () => {
  it('gives each file a group of its own when none is a sidecar', () => {
    expect(names(groupFiles([file('a.csv'), file('b.geojson'), file('c.obj')]))).toEqual([
      ['a.csv', []],
      ['b.geojson', []],
      ['c.obj', []],
    ]);
    expect(groupFiles([])).toEqual([]);
  });

  it('puts a .prj with the data file of the same name, wherever it is in the list', () => {
    const expected = [['points.csv', ['points.prj']]];
    expect(names(groupFiles([file('points.csv'), file('points.prj')]))).toEqual(expected);
    expect(names(groupFiles([file('points.prj'), file('points.csv')]))).toEqual(expected);
  });

  it('ignores case, and looks at everything before the last dot', () => {
    expect(names(groupFiles([file('Survey.2024.CSV'), file('survey.2024.PRJ')]))).toEqual([
      ['Survey.2024.CSV', ['survey.2024.PRJ']],
    ]);
    expect(names(groupFiles([file('survey.csv'), file('survey.2024.prj')]))).toEqual([
      ['survey.csv', []],
      ['survey.2024.prj', []],
    ]);
  });

  it('leaves a .prj with no data file to be looked at on its own', () => {
    expect(names(groupFiles([file('points.csv'), file('esri.prj')]))).toEqual([
      ['points.csv', []],
      ['esri.prj', []],
    ]);
    expect(names(groupFiles([file('lonely.prj')]))).toEqual([['lonely.prj', []]]);
  });

  it('gives a sidecar to every data file it describes', () => {
    expect(
      names(groupFiles([file('area.csv'), file('area.geojson'), file('area.prj'), file('x.obj')])),
    ).toEqual([
      ['area.csv', ['area.prj']],
      ['area.geojson', ['area.prj']],
      ['x.obj', []],
    ]);
  });

  it('keeps files from different folders apart', () => {
    const groups = groupFiles([
      file('points.csv', 'north/points.csv'),
      file('points.prj', 'south/points.prj'),
      file('points.prj', 'north/points.prj'),
    ]);
    expect(groups.map((g) => [g.file.webkitRelativePath, g.sidecars.length])).toEqual([
      ['north/points.csv', 1],
      ['south/points.prj', 0],
    ]);
    expect(groups[0]?.sidecars[0]?.webkitRelativePath).toBe('north/points.prj');
  });

  it('treats a name that starts with a dot, or has none, as having no extension', () => {
    expect(names(groupFiles([file('.prj'), file('data')]))).toEqual([
      ['.prj', []],
      ['data', []],
    ]);
  });

  it('does not change the list it is given', () => {
    const files = [file('a.prj'), file('a.csv')];
    groupFiles(files);
    expect(files.map((f) => f.name)).toEqual(['a.prj', 'a.csv']);
  });
});
