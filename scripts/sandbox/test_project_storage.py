import importlib.util
from pathlib import Path
import os
import sqlite3
import tempfile
import unittest
import uuid

spec = importlib.util.spec_from_file_location('storage', Path(__file__).with_name('prepare-project-storage.py'))
storage = importlib.util.module_from_spec(spec)
spec.loader.exec_module(storage)


class StorageTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name).resolve()
        self.source = self.base / 'source'
        self.destination = self.base / 'destination'
        self.source.mkdir()
        self.destination.mkdir()
        self.workspace = self.source / 'Test'
        self.workspace.mkdir()
        (self.workspace / 'document.txt').write_text('document')
        self.db = sqlite3.connect(':memory:')
        self.addCleanup(self.db.close)
        self.db.executescript('CREATE TABLE projects (id TEXT); CREATE TABLE project_workspaces (id TEXT, project_id TEXT, path TEXT);')
        self.project = str(uuid.uuid4())
        self.workspace_id = str(uuid.uuid4())
        self.db.execute('INSERT INTO projects VALUES (?)', (self.project,))
        self.db.execute('INSERT INTO project_workspaces VALUES (?, ?, ?)', (self.workspace_id, self.project, '/workspaces/Test'))

    def plan(self):
        return storage.plan(self.db, self.source, self.destination, [self.project])

    def test_read_only_plan_and_deterministic_paths(self):
        before = list(self.db.iterdump())
        result = self.plan()
        self.assertEqual(before, list(self.db.iterdump()))
        self.assertEqual(result['projects'][0]['workspaces'][0]['target'], str(self.destination / self.project / self.workspace_id))
        self.assertFalse(result['databaseChanged'])
        self.assertFalse(list(self.destination.iterdir()))

    def test_unknown_project_and_non_uuid_are_rejected(self):
        for value in ['../outside', str(uuid.uuid4())]:
            with self.assertRaises(ValueError):
                storage.plan(self.db, self.source, self.destination, [value])

    def test_external_source_and_traversal_rejected(self):
        for value in ['/appdata/service', '/workspaces/../source/Test', '/workspaces']:
            self.db.execute('UPDATE project_workspaces SET path = ?', (value,))
            with self.assertRaises(ValueError):
                self.plan()

    def test_symlink_rejected(self):
        (self.workspace / 'escape').symlink_to(self.base)
        with self.assertRaises(ValueError):
            self.plan()

    def test_hardlink_rejected(self):
        os.link(self.workspace / 'document.txt', self.base / 'outside-alias')
        with self.assertRaises(ValueError):
            self.plan()

    def test_named_pipe_rejected(self):
        os.mkfifo(self.workspace / 'pipe')
        with self.assertRaises(ValueError):
            self.plan()

    def test_content_change_is_detected(self):
        before = storage.inventory(self.workspace)
        (self.workspace / 'document.txt').write_text('updated')
        self.assertNotEqual(before, storage.inventory(self.workspace))

    def test_overlapping_sources_rejected(self):
        (self.workspace / 'nested').mkdir()
        self.db.execute('INSERT INTO project_workspaces VALUES (?, ?, ?)', (str(uuid.uuid4()), self.project, '/workspaces/Test/nested'))
        with self.assertRaises(ValueError):
            self.plan()


if __name__ == '__main__':
    unittest.main()
