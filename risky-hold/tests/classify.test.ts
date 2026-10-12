import { expect, test } from 'claude-code/testing'

import { riskOf } from '../hooks/classify'
import type { Shell } from '../hooks/classify'

const kindOf = (command: string, shell: Shell = 'bash') => riskOf(command, shell)?.kind ?? null

// A script being written to a file: its lines are text until something runs it.
const HEREDOC_TO_FILE = ["cat > cleanup.sh <<'EOF'", 'rm -rf src', 'git reset --hard', 'EOF'].join('\n')
const HEREDOC_TO_SHELL = ["bash <<'EOF'", 'rm -rf src', 'EOF'].join('\n')

test('holds a recursive delete', () => {
  expect(kindOf('rm -rf src')).toBe('delete')
  expect(kindOf('rm -r src')).toBe('delete')
  expect(kindOf('rm -fR ./lib')).toBe('delete')
  expect(kindOf('rm --recursive --force src')).toBe('delete')
  expect(kindOf('sudo rm -rf /var/www')).toBe('delete')
})

test('says what a held command would do', () => {
  expect(riskOf('rm -rf src', 'bash')).toEqual({ kind: 'delete', reason: 'deletes folders and everything in them' })
})

test('lets a plain delete of files through', () => {
  expect(kindOf('rm notes.txt')).toBe(null)
  expect(kindOf('rm -f notes.txt old.log')).toBe(null)
})

test('holds a delete with a broad or unknown target', () => {
  expect(kindOf('rm -rf .')).toBe('delete')
  expect(kindOf('rm -rf *')).toBe('delete')
  expect(kindOf('rm -rf ~')).toBe('delete')
  expect(kindOf('rm -rf "$DIR"')).toBe('delete')
  expect(kindOf('rm -rf ../node_modules')).toBe('delete')
  expect(kindOf('rm -rf /c/Users/admin/bin')).toBe('delete')
  expect(kindOf('rm -rf')).toBe('delete')
})

test('lets build output and temporary folders be deleted', () => {
  expect(kindOf('rm -rf node_modules')).toBe(null)
  expect(kindOf('rm -rf dist build coverage')).toBe(null)
  expect(kindOf('rm -rf ./src/App/bin ./src/App/obj')).toBe(null)
  expect(kindOf('rm -rf /tmp/scratch-123')).toBe(null)
  expect(kindOf('rm -rf "C:/Users/admin/AppData/Local/Temp/claude/work"')).toBe(null)
  expect(kindOf('rm -rf "$TMPDIR/build"')).toBe(null)
})

test('holds a delete when any one target is not disposable', () => {
  expect(kindOf('rm -rf node_modules src')).toBe('delete')
  expect(kindOf('rm -rf /tmp')).toBe('delete')
})

test('holds find when it deletes what it finds', () => {
  expect(kindOf('find . -name "*.log" -delete')).toBe('delete')
  expect(kindOf('find . -type d -exec rm -rf {} +')).toBe('delete')
  expect(kindOf('find . -name "*.log"')).toBe(null)
})

test('holds a delete handed to xargs', () => {
  expect(kindOf('git ls-files -o | xargs rm -rf')).toBe('delete')
  expect(kindOf('ls | xargs -I {} rm -r {}')).toBe('delete')
})

test('holds git commands that throw away uncommitted work', () => {
  expect(kindOf('git reset --hard')).toBe('discard')
  expect(kindOf('git reset --hard origin/main')).toBe('discard')
  expect(kindOf('git -C ../app reset --hard HEAD~1')).toBe('discard')
  expect(kindOf('git clean -fd')).toBe('discard')
  expect(kindOf('git clean --force -x')).toBe('discard')
  expect(kindOf('git checkout -- .')).toBe('discard')
  expect(kindOf('git checkout .')).toBe('discard')
  expect(kindOf('git restore .')).toBe('discard')
  expect(kindOf('git stash clear')).toBe('discard')
  expect(kindOf('git stash drop')).toBe('discard')
})

test('lets the gentle forms of those git commands through', () => {
  expect(kindOf('git reset --soft HEAD~1')).toBe(null)
  expect(kindOf('git reset HEAD file.txt')).toBe(null)
  expect(kindOf('git clean -n')).toBe(null)
  expect(kindOf('git clean -fd --dry-run')).toBe(null)
  expect(kindOf('git checkout main')).toBe(null)
  expect(kindOf('git checkout -- src/file.ts')).toBe(null)
  expect(kindOf('git restore --staged .')).toBe(null)
  expect(kindOf('git stash')).toBe(null)
  expect(kindOf('git stash pop')).toBe(null)
  expect(kindOf('git status')).toBe(null)
})

test('holds a force push and a remote branch delete', () => {
  expect(kindOf('git push --force')).toBe('force-push')
  expect(kindOf('git push -f origin main')).toBe('force-push')
  expect(kindOf('git push --force-with-lease origin feature')).toBe('force-push')
  expect(kindOf('git push origin +main')).toBe('force-push')
  expect(kindOf('git push origin --delete feature')).toBe('force-push')
  expect(kindOf('git push origin :feature')).toBe('force-push')
  expect(kindOf('git push origin main')).toBe(null)
  expect(kindOf('git push -u origin feature')).toBe(null)
})

test('holds a forced branch delete', () => {
  expect(kindOf('git branch -D feature')).toBe('branch-delete')
  expect(kindOf('git branch --delete --force feature')).toBe('branch-delete')
  expect(kindOf('git branch -d feature')).toBe(null)
})

test('holds commands that wipe a disk or stop the machine', () => {
  expect(kindOf('dd if=/dev/zero of=/dev/sda')).toBe('disk')
  expect(kindOf('mkfs.ext4 /dev/sdb1')).toBe('disk')
  expect(kindOf('dd if=a.img of=b.img')).toBe(null)
  expect(kindOf('shutdown -h now')).toBe('power')
  expect(kindOf('reboot')).toBe('power')
})

test('holds SQL that drops or empties tables, but not a search for it', () => {
  expect(kindOf('psql -c "DROP TABLE users"')).toBe('sql')
  expect(kindOf('sqlcmd -Q "truncate table Orders"')).toBe('sql')
  expect(kindOf('echo "DROP DATABASE shop" | psql')).toBe('sql')
  expect(kindOf('dotnet ef database drop --force')).toBe('sql')
  expect(kindOf('dotnet ef database drop', 'powershell')).toBe('sql')
  expect(kindOf('dotnet ef database update')).toBe(null)
  expect(kindOf('grep -ri "drop table" migrations/')).toBe(null)
  expect(kindOf('git commit -m "drop table users in migration 12"')).toBe(null)
})

test('finds a risky command anywhere on the line', () => {
  expect(kindOf('npm test && rm -rf src')).toBe('delete')
  expect(kindOf('cd app; git reset --hard')).toBe('discard')
  expect(kindOf('ls\nrm -rf src')).toBe('delete')
  expect(kindOf('echo done || git push --force')).toBe('force-push')
})

test('reads a command wrapped in another shell or a substitution', () => {
  expect(kindOf('bash -c "rm -rf src"')).toBe('delete')
  expect(kindOf('bash -lc "cd app && rm -rf src"')).toBe('delete')
  expect(kindOf("sh -c 'git reset --hard'")).toBe('discard')
  expect(kindOf('echo $(rm -rf src)')).toBe('delete')
  expect(kindOf('eval "git clean -fd"')).toBe('discard')
  expect(kindOf('cmd /c "rd /s /q src"')).toBe('delete')
  expect(kindOf('powershell -Command "Remove-Item src -Recurse"')).toBe('delete')
})

test('does not mistake quoted text for a command', () => {
  expect(kindOf('echo "rm -rf src"')).toBe(null)
  expect(kindOf('git commit -m "fix; rm -rf handling"')).toBe(null)
  expect(kindOf("grep -n 'git reset --hard' docs/*.md")).toBe(null)
})

test('treats a heredoc as text unless a shell reads it', () => {
  expect(kindOf(HEREDOC_TO_FILE)).toBe(null)
  expect(kindOf(HEREDOC_TO_SHELL)).toBe('delete')
})

test('holds a recursive delete in PowerShell, whatever it is called', () => {
  expect(kindOf('Remove-Item src -Recurse -Force', 'powershell')).toBe('delete')
  expect(kindOf('remove-item -Path src, lib -rec', 'powershell')).toBe('delete')
  expect(kindOf('rm src -r -fo', 'powershell')).toBe('delete')
  expect(kindOf('del src -Recurse', 'powershell')).toBe('delete')
  expect(kindOf('rd /s /q src', 'powershell')).toBe('delete')
  expect(kindOf('Get-ChildItem -Directory | Remove-Item -Recurse', 'powershell')).toBe('delete')
})

test('lets PowerShell delete files, build output and temporary folders', () => {
  expect(kindOf('Remove-Item notes.txt', 'powershell')).toBe(null)
  expect(kindOf('Remove-Item -Recurse -Force node_modules', 'powershell')).toBe(null)
  expect(kindOf('Remove-Item -Recurse .\\src\\App\\bin, .\\src\\App\\obj', 'powershell')).toBe(null)
  expect(kindOf('Remove-Item -Recurse "$env:TEMP\\work"', 'powershell')).toBe(null)
  expect(kindOf('Remove-Item -Recurse C:\\Users\\admin\\AppData\\Local\\Temp\\work', 'powershell')).toBe(null)
})

test('holds PowerShell commands that wipe a disk or stop the machine', () => {
  expect(kindOf('Format-Volume -DriveLetter D', 'powershell')).toBe('disk')
  expect(kindOf('Clear-Disk -Number 1 -RemoveData', 'powershell')).toBe('disk')
  expect(kindOf('format D: /q', 'powershell')).toBe('disk')
  expect(kindOf('Restart-Computer -Force', 'powershell')).toBe('power')
  expect(kindOf('Stop-Computer', 'powershell')).toBe('power')
})

test('holds git and SQL in PowerShell as in bash', () => {
  expect(kindOf('git reset --hard', 'powershell')).toBe('discard')
  expect(kindOf('& git push --force', 'powershell')).toBe('force-push')
  expect(kindOf('Invoke-Sqlcmd -Query "DROP TABLE Users"', 'powershell')).toBe('sql')
  expect(kindOf('Select-String -Pattern "drop table" *.sql', 'powershell')).toBe(null)
})

test('treats a PowerShell here-string as text', () => {
  const command = ["$notes = @'", 'rm -rf src', "'@", 'Set-Content notes.md $notes'].join('\n')

  expect(kindOf(command, 'powershell')).toBe(null)
})

test('finds nothing risky in ordinary work', () => {
  expect(kindOf('npm install && npm run build')).toBe(null)
  expect(kindOf('dotnet build src/App.sln -c Release')).toBe(null)
  expect(kindOf('ls -la')).toBe(null)
  expect(kindOf('')).toBe(null)
  expect(kindOf('Get-ChildItem -Recurse | Select-Object Name', 'powershell')).toBe(null)
})
