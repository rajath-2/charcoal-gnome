import Clutter from 'gi://Clutter';
import Cogl from 'gi://Cogl';
import GObject from 'gi://GObject';
import Shell from 'gi://Shell';
import {PACKAGE_VERSION} from 'resource:///org/gnome/shell/misc/config.js';

// A fragment-snippet effect; subclasses return [declarations, code] from snippet().
// Shell 51's Clutter.ShaderEffect takes a static Cogl.Snippet; Shell 50's only compiles full
// programs, so there the same snippet goes on Shell.GLSLEffect, whose uniforms are set by location.
export const SnippetEffect = parseInt(PACKAGE_VERSION) >= 51
    ? GObject.registerClass(class SnippetEffect extends Clutter.ShaderEffect {
        vfunc_get_static_snippet() {
            return Cogl.Snippet.new(Cogl.SnippetHook.FRAGMENT, ...this.snippet());
        }
    })
    : GObject.registerClass(class SnippetEffect extends Shell.GLSLEffect {
        vfunc_build_pipeline() {
            this.add_glsl_snippet(Cogl.SnippetHook.FRAGMENT, ...this.snippet(), false);
        }

        set_uniform_float(name, components, values) {
            super.set_uniform_float(this.get_uniform_location(name), components, values);
        }
    });
