# homebridge-hue/Makefile
# (C) 2016, Erik Baauw

all:
	npm install

.PHONY:	clean distr
clean:
	rm -f .DS_Store lib/.DS_Store
	rm -fr node_modules
	xattr -cr .

distr:	clean
	(cd ..; tar cvzf homebridge-hue.tar.gz ./homebridge-hue)
