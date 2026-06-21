import main
p = main.ROOT_DIR / 'projects_landing'
score, sigs = main.compute_health_score(p, has_readme=True, git_dirty=False, has_git=True)
print('score', score)
for s in sigs:
    print(s.key, s.applicable, s.score, s.weight, '|', s.detail)
proj = main.build_project(p)
print('build_project health_score', proj.health_score)
